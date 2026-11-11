import {
  EFFORTS,
  GENERATION_LIMITS,
  IMAGE_PROVIDERS,
  IMAGE_QUALITIES,
  LOCALES,
  MODEL_LIST_TARGETS,
  PROVIDER_KINDS,
  type CreateSessionRequest,
  type ErrorResponse,
  type ForkSessionRequest,
  type GeneratePortraitRequest,
  type GeneratePortraitResponse,
  type ImageMessage,
  type ModelListResponse,
  type ModuleId,
  type ModuleLibraryResponse,
  type RetryImageResponse,
  type RollbackSessionRequest,
  type Session,
  type SessionBackup,
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
import { attachPicture, buildCharacterPortraitPrompt } from './engine/world';
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
import {
  newSessionId,
  recordSessionUsage,
  recordSnapshot,
  rollbackSessionState,
  type SessionStore,
} from './store/sessionStore';
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

const rollbackSchema = z.object({
  toTurn: z.number().int().min(0).max(100_000),
}) satisfies z.ZodType<RollbackSessionRequest>;

const forkSchema = z.object({
  upToTurn: z.number().int().min(0).max(100_000).optional(),
}) satisfies z.ZodType<ForkSessionRequest>;

const generatePortraitSchema = z.object({
  prompt: z.string().trim().max(2000).optional(),
}) satisfies z.ZodType<GeneratePortraitRequest>;

const rawSessionSchema = z.looseObject({
  id: z.string().max(120).optional().default('imported'),
  createdAt: z.string().max(80).optional(),
  updatedAt: z.string().max(80).optional(),
  language: z.enum(LOCALES),
  seed: z
    .object({
      premise: z.string().max(8000).default(''),
      playerName: z.string().max(200).default(''),
      playerConcept: z.string().max(4000).default(''),
    })
    .default({ premise: '', playerName: '', playerConcept: '' }),
  world: z.looseObject({
    title: z.string().default(''),
    premise: z.string().default(''),
    scene: z.object({
      locationId: z.string().nullable().default(null),
      time: z.string().default(''),
      weather: z.string().default(''),
      summary: z.string().default(''),
    }),
    playerId: z.string().nullable().default(null),
    characters: z.record(z.string(), z.looseObject({ id: z.string(), name: z.string() })).default({}),
    locations: z.record(z.string(), z.looseObject({ id: z.string(), name: z.string() })).default({}),
    items: z.record(z.string(), z.looseObject({ id: z.string(), name: z.string() })).default({}),
    quests: z.record(z.string(), z.looseObject({ id: z.string(), title: z.string() })).default({}),
    lore: z.record(z.string(), z.looseObject({ id: z.string(), title: z.string() })).default({}),
    suggestions: z.array(z.string()).default([]),
    turn: z.number().int().min(0).default(0),
  }),
  messages: z.array(z.looseObject({ id: z.string(), turn: z.number().int(), kind: z.string() })).default([]),
});

const backupImagesSchema = z.record(
  z.string().max(120),
  z.object({ contentType: z.string().max(100), dataBase64: z.string() }),
);

const importPayloadSchema = z.union([
  z.object({
    version: z.literal(1),
    exportedAt: z.string().optional(),
    session: rawSessionSchema,
    images: backupImagesSchema.optional().default({}),
  }),
  rawSessionSchema.transform((session) => ({ version: 1 as const, session, images: {} })),
]);

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
      provider: z.enum(IMAGE_PROVIDERS).optional(),
      model: model.optional(),
      baseUrl: baseUrl.optional(),
      quality: z.enum(IMAGE_QUALITIES).optional(),
      autoCharacterPortraits: z.boolean().optional(),
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
  const activeTurns = new Map<string, { session: Session; emit: (event: TurnEvent) => void }>();
  const writeQueues = new Map<string, Promise<void>>();

  const claim = (id: string): void => {
    if (running.has(id)) throw new AppError('turn_in_progress', 'A turn is being generated for this session.');
    running.add(id);
  };

  const enqueueSessionTask = <T>(id: string, fn: () => Promise<T>): Promise<T> => {
    const prev = writeQueues.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const settled = next.then(
      () => {},
      () => {},
    );
    writeQueues.set(id, settled);
    settled.finally(() => {
      if (writeQueues.get(id) === settled) writeQueues.delete(id);
    });
    return next;
  };

  const applySettledPicture = (sessionId: string, settled: ImageMessage): Promise<void> =>
    enqueueSessionTask(sessionId, async () => {
      const attachTo = (target: Session): boolean => {
        const idx = target.messages.findIndex((m) => m.id === settled.id && m.kind === 'image');
        if (idx < 0) return false;
        target.messages[idx] = settled;
        if (settled.status === 'ready' && settled.url) {
          attachPicture(target.world, settled.subject, settled.targetId, settled.url);
          for (const snap of target.snapshots ?? []) {
            if (snap.turn >= settled.turn) {
              attachPicture(snap.world, settled.subject, settled.targetId, settled.url);
            }
          }
        }
        return true;
      };

      const active = activeTurns.get(sessionId);
      if (active) {
        if (attachTo(active.session)) {
          active.emit({ type: 'message', message: settled });
          if (settled.status === 'ready') {
            active.emit({ type: 'world', world: active.session.world });
          }
        }
        return;
      }

      const latest = await sessions.get(sessionId);
      if (!latest || !attachTo(latest)) return;
      await sessions.save(latest);
    });

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

  app.post('/api/sessions/import', async (c) => {
    const payload = await readBody(c, importPayloadSchema);
    const freshId = newSessionId();
    const urlByOldFile = await images.importSession(freshId, payload.images);
    const rewriteUrl = (url: string): string => {
      const match = /^\/api\/images\/[^/]+\/([^/?#]+)$/.exec(url);
      if (!match) return url;
      return urlByOldFile.get(match[1]!) ?? url;
    };
    const imported = await sessions.importWithId(freshId, payload.session as unknown as Session, rewriteUrl);
    return c.json(imported, 201);
  });

  app.get('/api/sessions/:id', async (c) => {
    const id = c.req.param('id');
    await (writeQueues.get(id) ?? Promise.resolve());
    const session = await sessions.get(id);
    if (!session) throw new AppError('not_found', 'No such session.');
    return c.json(session);
  });

  app.get('/api/sessions/:id/export', async (c) => {
    const id = c.req.param('id');
    await (writeQueues.get(id) ?? Promise.resolve());
    const session = await sessions.get(id);
    if (!session) throw new AppError('not_found', 'No such session.');
    const exportedImages = await images.exportSession(id);
    const backup: SessionBackup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      session,
      images: exportedImages,
    };
    return c.json(backup);
  });

  app.post('/api/sessions/:id/rollback', async (c) => {
    const id = c.req.param('id');
    const body = await readBody(c, rollbackSchema);
    claim(id);
    try {
      await (writeQueues.get(id) ?? Promise.resolve());
      const session = await sessions.get(id);
      if (!session) throw new AppError('not_found', 'No such session.');
      rollbackSessionState(session, body.toTurn);
      await sessions.save(session);
      return c.json(session);
    } finally {
      running.delete(id);
    }
  });

  app.post('/api/sessions/:id/fork', async (c) => {
    const id = c.req.param('id');
    const body = await readBody(c, forkSchema);
    await (writeQueues.get(id) ?? Promise.resolve());
    const session = await sessions.get(id);
    if (!session) throw new AppError('not_found', 'No such session.');
    const oldPrefix = `/api/images/${id}/`;
    const forked = await sessions.fork(session, body.upToTurn, (url, newId) =>
      url.startsWith(oldPrefix) ? `/api/images/${newId}/${url.slice(oldPrefix.length)}` : url,
    );
    await images.copySession(id, forked.id);
    return c.json(forked, 201);
  });

  app.post('/api/sessions/:id/images/:messageId/retry', async (c) => {
    const id = c.req.param('id');
    const messageId = c.req.param('messageId');
    await (writeQueues.get(id) ?? Promise.resolve());
    const session = activeTurns.get(id)?.session ?? (await sessions.get(id));
    if (!session) throw new AppError('not_found', 'No such session.');
    const target = session.messages.find((m): m is ImageMessage => m.id === messageId && m.kind === 'image');
    if (!target) throw new AppError('not_found', 'No such illustration.');

    const current = await settings.get();
    const painter = makePainter(current);
    if (!painter) throw new AppError('not_configured', 'Illustrations are not enabled or configured.');

    const rawPrompt = target.prompt?.trim() || target.caption.trim();
    if (!rawPrompt) throw new AppError('bad_request', 'This illustration has no prompt to repaint.');

    const style = session.world.artStyle;
    const painting = await painter.paint({
      prompt: style ? `${rawPrompt}\n\nArt style: ${style}` : rawPrompt,
      subject: target.subject,
      signal: c.req.raw.signal,
    });
    const url = await images.save(id, painting);
    const settled: ImageMessage = {
      id: target.id,
      turn: target.turn,
      createdAt: target.createdAt,
      kind: 'image',
      status: 'ready',
      url,
      caption: target.caption,
      ...(target.prompt ? { prompt: target.prompt } : {}),
      subject: target.subject,
      targetId: target.targetId,
    };
    await applySettledPicture(id, settled);
    const updated = activeTurns.get(id)?.session ?? (await sessions.get(id)) ?? session;
    const response: RetryImageResponse = { message: settled, world: updated.world };
    return c.json(response);
  });

  app.post('/api/sessions/:id/characters/:characterId/portrait', async (c) => {
    const id = c.req.param('id');
    const characterId = c.req.param('characterId');
    const rawBody: unknown = await c.req.json().catch(() => ({}));
    const parsedBody = generatePortraitSchema.safeParse(rawBody ?? {});
    if (!parsedBody.success) throw new AppError('bad_request', z.prettifyError(parsedBody.error));

    await (writeQueues.get(id) ?? Promise.resolve());
    const session = activeTurns.get(id)?.session ?? (await sessions.get(id));
    if (!session) throw new AppError('not_found', 'No such session.');
    const character = session.world.characters[characterId];
    if (!character) throw new AppError('not_found', 'No such character.');

    const current = await settings.get();
    const painter = makePainter(current);
    if (!painter) throw new AppError('not_configured', 'Illustrations are not enabled or configured.');

    const rawPrompt = buildCharacterPortraitPrompt(character, session.world, parsedBody.data.prompt);
    const style = session.world.artStyle;
    const painting = await painter.paint({
      prompt: style ? `${rawPrompt}\n\nArt style: ${style}` : rawPrompt,
      subject: 'character',
      signal: c.req.raw.signal,
    });
    const url = await images.save(id, painting);

    await enqueueSessionTask(id, async () => {
      const applyPortrait = (target: Session): boolean => {
        if (!attachPicture(target.world, 'character', characterId, url)) return false;
        for (const snap of target.snapshots ?? []) {
          const snapChar = snap.world.characters[characterId];
          if (snapChar && (!snapChar.imageUrl || snap.turn >= target.world.turn)) {
            snapChar.imageUrl = url;
          }
        }
        return true;
      };

      const active = activeTurns.get(id);
      if (active) {
        if (applyPortrait(active.session)) {
          active.emit({ type: 'world', world: active.session.world });
        }
        return;
      }

      const latest = await sessions.get(id);
      if (!latest || !applyPortrait(latest)) return;
      await sessions.save(latest);
    });

    const updated = activeTurns.get(id)?.session ?? (await sessions.get(id)) ?? session;
    const response: GeneratePortraitResponse = { characterId, url, world: updated.world };
    return c.json(response);
  });

  app.patch('/api/sessions/:id', async (c) => {
    const id = c.req.param('id');
    const patch = await readBody(c, updateSessionSchema);
    // A turn in progress is playing with the modules it started with.
    claim(id);
    try {
      await (writeQueues.get(id) ?? Promise.resolve());
      const session = await sessions.get(id);
      if (!session) throw new AppError('not_found', 'No such session.');
      // Only what the player subscribes to can be switched on. A module the story
      // already has stays listed if they have since unsubscribed, for when they return.
      const { subscribedModules } = await settings.get();
      const kept = session.modules.filter((modId) => !subscribedModules.includes(modId));
      session.modules = normalizeModules([...kept, ...patch.modules.filter((modId) => subscribedModules.includes(modId))]);
      // The player has chosen; the game master no longer does.
      session.modulesAuto = false;
      recordSnapshot(session);
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
      await (writeQueues.get(id) ?? Promise.resolve());
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
      await (writeQueues.get(id) ?? Promise.resolve());
      const session = await sessions.get(id);
      if (!session) throw new AppError('not_found', 'No such session.');
      validateTurn(session, request);
      const current = await settings.get();
      const painter = makePainter(current);
      return {
        session,
        provider: makeProvider(current, 'gameMaster'),
        // Only a talk turn has a character speak for themselves.
        actorProvider: request.kind === 'talk' ? makeProvider(current, 'actor') : undefined,
        painter,
        autoCharacterPortraits: Boolean(painter && current.image.autoCharacterPortraits),
        subscribed: current.subscribedModules,
        tuning: { historyTurns: current.generation.historyTurns, memoriesRecalled: current.generation.memoriesRecalled },
      };
    })().catch((err: unknown) => {
      running.delete(id);
      throw err;
    });
    const { session, provider, actorProvider, painter, autoCharacterPortraits, subscribed, tuning } = prepared;

    return streamSSE(c, async (stream) => {
      const abort = new AbortController();
      stream.onAbort(() => abort.abort());

      // Serialize at once (the world keeps changing), then write in order.
      let writes: Promise<unknown> = Promise.resolve();
      const emit = (event: TurnEvent): void => {
        const frame = { event: event.type, data: JSON.stringify(event) };
        writes = writes.then(() => stream.writeSSE(frame)).catch(() => {});
      };

      // Capture the pre-turn checkpoint if an older upgraded save did not have one yet.
      if (!session.snapshots?.some((s) => s.turn === session.world.turn)) {
        recordSnapshot(session);
      }
      activeTurns.set(id, { session, emit });

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
          autoCharacterPortraits,
          onBackgroundPicture: painter ? (settled) => applySettledPicture(id, settled) : undefined,
        });
        if (outcome.committed) {
          await enqueueSessionTask(id, async () => {
            activeTurns.delete(id);
            recordSessionUsage(session, outcome.usage);
            recordSnapshot(session);
            await sessions.save(session);
          });
        } else {
          await enqueueSessionTask(id, async () => {
            activeTurns.delete(id);
          });
        }
        emit(
          outcome.error
            ? { type: 'error', error: outcome.error.toApiError(), kept: outcome.committed }
            : { type: 'done', turn: session.world.turn, usage: outcome.usage, modules: session.modules },
        );
      } catch (err) {
        console.error(err);
        emit({ type: 'error', error: toAppError(err).toApiError(), kept: false });
      } finally {
        activeTurns.delete(id);
        running.delete(id);
        await writes;
      }
    });
  });

  if (deps.webDist) serveWebApp(app, deps.webDist);
  return app;
}
