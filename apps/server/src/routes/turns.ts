import { resolveModelContextWindow, type TurnEvent } from '@roleplay/shared';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { runTurn, validateTurn } from '../engine/gameMaster';
import { AppError, toAppError } from '../errors';
import type { Painter } from '../images/types';
import type { LLMProvider } from '../llm/types';
import type { SessionCoordinator } from '../sessionCoordinator';
import type { ImageStore } from '../store/imageStore';
import { recordSessionUsage, recordSnapshot, type SessionStore } from '../store/sessionStore';
import { resolveRole, type ResolvedSettings, type SettingsStore } from '../store/settingsStore';
import { readBody, turnSchema } from './schemas';

export interface TurnRouteDeps {
  sessions: SessionStore;
  settings: SettingsStore;
  images: ImageStore;
  coordinator: SessionCoordinator;
  makeProvider: (settings: ResolvedSettings, role: 'gameMaster' | 'actor') => LLMProvider;
  makePainter: (settings: ResolvedSettings) => Painter | null;
}

export function registerTurnRoutes(app: Hono, deps: TurnRouteDeps): void {
  const { sessions, settings, images, coordinator, makeProvider, makePainter } = deps;

  app.post('/api/sessions/:id/turns', async (c) => {
    const id = c.req.param('id');
    const request = await readBody(c, turnSchema);
    coordinator.claim(id);

    const prepared = await (async () => {
      await coordinator.waitPending(id);
      const session = await sessions.get(id);
      if (!session) throw new AppError('not_found', 'No such session.');
      validateTurn(session, request);
      const current = await settings.get();
      const painter = makePainter(current);

      let actorProvider: LLMProvider | undefined;
      if (request.kind === 'talk') {
        actorProvider = makeProvider(current, 'actor');
      } else if (current.actor.provider !== 'same') {
        // Route rolling background story summaries onto the lightweight actor model when configured.
        try {
          actorProvider = makeProvider(current, 'actor');
        } catch {
          actorProvider = undefined;
        }
      }

      const gmRole = resolveRole(current, 'gameMaster');
      return {
        session,
        provider: makeProvider(current, 'gameMaster'),
        actorProvider,
        painter,
        autoCharacterPortraits: Boolean(painter && current.image.autoCharacterPortraits),
        subscribed: current.subscribedModules,
        tuning: {
          historyTurns: current.generation.historyTurns,
          memoriesRecalled: current.generation.memoriesRecalled,
          contextWindow: resolveModelContextWindow(gmRole.provider, gmRole.model),
        },
      };
    })().catch((err: unknown) => {
      coordinator.release(id);
      throw err;
    });

    const { session, provider, actorProvider, painter, autoCharacterPortraits, subscribed, tuning } = prepared;

    return streamSSE(c, async (stream) => {
      const abort = new AbortController();
      stream.onAbort(() => abort.abort());

      let writes: Promise<unknown> = Promise.resolve();
      const emit = (event: TurnEvent): void => {
        const frame = { event: event.type, data: JSON.stringify(event) };
        writes = writes.then(() => stream.writeSSE(frame)).catch(() => {});
      };

      if (!session.snapshots?.some((s) => s.turn === session.world.turn)) {
        recordSnapshot(session);
      }
      coordinator.setActiveTurn(id, session, emit);

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
          onBackgroundPicture: painter ? (settled) => coordinator.applySettledPicture(id, settled) : undefined,
        });
        if (outcome.committed) {
          await coordinator.enqueue(id, async () => {
            coordinator.clearActiveTurn(id);
            recordSessionUsage(session, outcome.usage);
            recordSnapshot(session);
            await sessions.save(session);
          });
        } else {
          await coordinator.enqueue(id, async () => {
            coordinator.clearActiveTurn(id);
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
        coordinator.clearActiveTurn(id);
        coordinator.release(id);
        await writes;
      }
    });
  });
}
