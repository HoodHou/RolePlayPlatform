import {
  EFFORTS,
  GENERATION_LIMITS,
  IMAGE_QUALITIES,
  LOCALES,
  MODEL_LIST_TARGETS,
  PROVIDER_KINDS,
  type CreateSessionRequest,
  type ErrorResponse,
  type ModelListResponse,
  type ModuleId,
  type ModuleLibraryResponse,
  type TurnEvent,
  type TurnRequest,
  type UpdateSessionRequest,
  type UpdateSettingsRequest,
} from '@roleplay/shared';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import { runTurn, validateTurn } from './engine/gameMaster';
import {
  allModuleIds,
  listLibrary,
  listPlugins,
  normalizeModules,
  pluginManifestSchema,
  PluginStore,
  registerPlugin,
  unregisterPlugin,
} from './engine/modules';
import { AppError, toAppError } from './errors';
import { createPainter } from './images';
import type { Painter } from './images/types';
import { createProvider } from './llm';
import { listModels } from './llm/models';
import type { LLMProvider } from './llm/types';
import { serveWebApp } from './static';
import type { ImageStore } from './store/imageStore';
import type { SessionStore } from './store/sessionStore';
import type { ResolvedSettings, SettingsStore } from './store/settingsStore';
import { toPublicSettings } from './store/settingsStore';

export interface AppDeps {
  sessions: SessionStore;
  settings: SettingsStore;
  images: ImageStore;
  plugins?: PluginStore;
  /** Folder of the built web app; omit to serve the API only. */
  webDist?: string;
  /** Overridable for tests. */
  createProvider?: (settings: ResolvedSettings, role: 'gameMaster' | 'actor') => LLMProvider;
  createPainter?: (settings: ResolvedSettings) => Painter | null;
}

const moduleIdSchema = z
  .string()
  .refine((value): value is ModuleId => allModuleIds().includes(value as ModuleId), 'Unknown module id.');
const modules = z.array(moduleIdSchema).max(64);

const createSessionSchema = z.object({
  language: z.enum(LOCALES),
  premise: z.string().max(4000).optional(),
  playerName: z.string().max(80).optional(),
  playerConcept: z.string().max(2000).optional(),
  modules: modules.optional(),
}) satisfies z.ZodType<CreateSessionRequest>;

const updateSessionSchema = z.object({ modules }) satisfies z.ZodType<UpdateSessionRequest>;

const spoken = z.string().trim().min(1).max(8000);
const turnSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('start') }),
  z.object({ kind: z.literal('action'), text: spoken }),
  z.object({ kind: z.literal('talk'), characterId: z.string().min(1).max(64), text: spoken }),
]) satisfies z.ZodType<TurnRequest>;

const baseUrl = z
  .string()
  .trim()
  .max(500)
  .refine((value) => value === '' || /^https?:\/\//i.test(value), 'Must be an http(s) URL.');
const model = z.string().trim().max(200);
const apiKey = z.string().max(500).nullable().optional();

const effort = z.enum(EFFORTS).nullable();
const connection = z.object({ model: model.optional(), baseUrl: baseUrl.optional(), apiKey });
const limits = GENERATION_LIMITS;

const settingsSchema = z.object({
  gameMaster: z
    .object({ provider: z.enum(PROVIDER_KINDS).optional(), model: model.optional(), effort: effort.optional() })
    .optional(),
  actor: z
    .object({
      provider: z.enum([...PROVIDER_KINDS, 'same']).optional(),
      model: model.optional(),
      effort: effort.optional(),
    })
    .optional(),
  connections: z
    .object({
      anthropic: connection.optional(),
      openai: connection.optional(),
      gemini: connection.optional(),
      custom: connection.optional(),
    })
    .optional(),
  generation: z
    .object({
      maxOutputTokens: z.number().int().min(limits.maxOutputTokens.min).max(limits.maxOutputTokens.max).nullable().optional(),
      temperature: z.number().min(limits.temperature.min).max(limits.temperature.max).nullable().optional(),
      historyTurns: z.number().int().min(limits.historyTurns.min).max(limits.historyTurns.max).optional(),
      memoriesRecalled: z.number().int().min(limits.memoriesRecalled.min).max(limits.memoriesRecalled.max).optional(),
    })
    .optional(),
  image: z
    .object({
      enabled: z.boolean().optional(),
      model: model.optional(),
      baseUrl: baseUrl.optional(),
      quality: z.enum(IMAGE_QUALITIES).optional(),
      apiKey,
    })
    .optional(),
  subscribedModules: modules.optional(),
}) satisfies z.ZodType<UpdateSettingsRequest>;

async function readBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  const json: unknown = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new AppError('bad_request', z.prettifyError(parsed.error));
  return parsed.data;
}

export function createApp(deps: AppDeps): Hono {
  const { sessions, settings, images } = deps;
  const makeProvider = deps.createProvider ?? createProvider;
  const makePainter = deps.createPainter ?? createPainter;
  // A session is read, changed and saved by one request at a time: a turn
  // mutates the world as it runs, and anything else written to the session
  // meanwhile would be lost when the turn saves. The claim is taken before the
  // session is read, so nothing can slip in between the reading and the claiming.
  const running = new Set<string>();
  const claim = (id: string): void => {
    if (running.has(id)) throw new AppError('turn_in_progress', 'A turn is being generated for this session.');
    running.add(id);
  };

  const app = new Hono();

  app.onError((err, c) => {
    const error = toAppError(err);
    if (error.code === 'internal') console.error(err);
    const body: ErrorResponse = { error: error.toApiError() };
    return c.json(body, error.status as ContentfulStatusCode);
  });

  app.notFound((c) => {
    const body: ErrorResponse = { error: { code: 'not_found', message: `No route for ${c.req.path}` } };
    return c.json(body, 404);
  });

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.get('/api/settings', async (c) => c.json(toPublicSettings(await settings.get())));

  app.put('/api/settings', async (c) => {
    const patch = await readBody(c, settingsSchema);
    return c.json(toPublicSettings(await settings.update(patch)));
  });

  app.get('/api/settings/models', async (c) => {
    const target = z.enum(MODEL_LIST_TARGETS).safeParse(c.req.query('target'));
    if (!target.success) throw new AppError('bad_request', `target must be one of: ${MODEL_LIST_TARGETS.join(', ')}`);
    const body: ModelListResponse = { models: await listModels(target.data, await settings.get()) };
    return c.json(body);
  });

  app.get('/api/modules', async (c) => {
    const body: ModuleLibraryResponse = { modules: listLibrary((await settings.get()).subscribedModules) };
    return c.json(body);
  });

  app.get('/api/plugins', (c) => c.json({ plugins: listPlugins() }));

  app.post('/api/plugins', async (c) => {
    const manifest = await readBody(c, pluginManifestSchema);
    const compiled = deps.plugins ? await deps.plugins.save(manifest) : registerPlugin(manifest);
    registerPlugin(compiled);
    const modules = listLibrary((await settings.get()).subscribedModules);
    return c.json({ plugin: compiled.manifest, modules }, 201);
  });

  app.delete('/api/plugins/:id', async (c) => {
    const id = c.req.param('id');
    const removedMem = unregisterPlugin(id);
    const removedDisk = deps.plugins ? await deps.plugins.remove(id) : false;
    if (!removedMem && !removedDisk) throw new AppError('not_found', `No plugin with id "${id}".`);
    const modules = listLibrary((await settings.get()).subscribedModules);
    return c.json({ ok: true, modules });
  });

  app.get('/api/sessions', async (c) => c.json(await sessions.list()));

  app.post('/api/sessions', async (c) => {
    const request = await readBody(c, createSessionSchema);
    return c.json(await sessions.create(request, (await settings.get()).subscribedModules), 201);
  });

  app.get('/api/sessions/:id', async (c) => {
    const session = await sessions.get(c.req.param('id'));
    if (!session) throw new AppError('not_found', 'No such session.');
    return c.json(session);
  });

  app.patch('/api/sessions/:id', async (c) => {
    const id = c.req.param('id');
    const patch = await readBody(c, updateSessionSchema);
    // A turn in progress is playing with the modules it started with.
    claim(id);
    try {
      const session = await sessions.get(id);
      if (!session) throw new AppError('not_found', 'No such session.');
      // Only what the player subscribes to can be switched on. A module the story
      // already has stays listed if they have since unsubscribed, for when they return.
      const { subscribedModules } = await settings.get();
      const kept = session.modules.filter((id) => !subscribedModules.includes(id));
      session.modules = normalizeModules([...kept, ...patch.modules.filter((id) => subscribedModules.includes(id))]);
      // The player has chosen; the game master no longer does.
      session.modulesAuto = false;
      await sessions.save(session);
      return c.json(session);
    } finally {
      running.delete(id);
    }
  });

  app.delete('/api/sessions/:id', async (c) => {
    const id = c.req.param('id');
    claim(id);
    try {
      if (!(await sessions.delete(id))) throw new AppError('not_found', 'No such session.');
      await images.deleteSession(id);
      return c.json({ ok: true });
    } finally {
      running.delete(id);
    }
  });

  app.get('/api/images/:sessionId/:file', async (c) => {
    const image = await images.read(c.req.param('sessionId'), c.req.param('file'));
    if (!image) throw new AppError('not_found', 'No such image.');
    return c.body(new Uint8Array(image.data), 200, {
      'Content-Type': image.contentType,
      // A picture never changes once painted.
      'Cache-Control': 'private, max-age=31536000, immutable',
      // Pictures are only ever meant to be shown as images.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'X-Content-Type-Options': 'nosniff',
    });
  });

  app.post('/api/sessions/:id/turns', async (c) => {
    const id = c.req.param('id');
    const request = await readBody(c, turnSchema);
    claim(id);
    // Anything wrong before generation starts is a plain JSON error, not a stream.
    const prepared = await (async () => {
      const session = await sessions.get(id);
      if (!session) throw new AppError('not_found', 'No such session.');
      validateTurn(session, request);
      const current = await settings.get();
      return {
        session,
        provider: makeProvider(current, 'gameMaster'),
        // Only a talk turn has a character speak for themselves.
        actorProvider: request.kind === 'talk' ? makeProvider(current, 'actor') : undefined,
        painter: makePainter(current),
        subscribed: current.subscribedModules,
        tuning: { historyTurns: current.generation.historyTurns, memoriesRecalled: current.generation.memoriesRecalled },
      };
    })().catch((err: unknown) => {
      running.delete(id);
      throw err;
    });
    const { session, provider, actorProvider, painter, subscribed, tuning } = prepared;

    return streamSSE(c, async (stream) => {
      const abort = new AbortController();
      stream.onAbort(() => abort.abort());

      // Serialize at once (the world keeps changing), then write in order.
      let writes: Promise<unknown> = Promise.resolve();
      const emit = (event: TurnEvent): void => {
        const frame = { event: event.type, data: JSON.stringify(event) };
        writes = writes.then(() => stream.writeSSE(frame)).catch(() => {});
      };

      try {
        const outcome = await runTurn(session, request, {
          provider,
          actorProvider,
          tuning,
          subscribed,
          emit,
          signal: abort.signal,
          illustrate: painter
            ? async (paintRequest) => images.save(session.id, await painter.paint(paintRequest))
            : undefined,
        });
        if (outcome.committed) await sessions.save(session);
        emit(
          outcome.error
            ? { type: 'error', error: outcome.error.toApiError(), kept: outcome.committed }
            : { type: 'done', turn: session.world.turn, usage: outcome.usage, modules: session.modules },
        );
      } catch (err) {
        console.error(err);
        emit({ type: 'error', error: toAppError(err).toApiError(), kept: false });
      } finally {
        running.delete(id);
        await writes;
      }
    });
  });

  if (deps.webDist) serveWebApp(app, deps.webDist);
  return app;
}
