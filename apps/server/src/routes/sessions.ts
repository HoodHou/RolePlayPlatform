import { randomUUID } from 'node:crypto';
import type {
  EventMessage,
  GeneratePortraitResponse,
  ImageMessage,
  Message,
  ModuleOperationResponse,
  RetryImageResponse,
  Session,
  SessionBackup,
} from '@roleplay/shared';
import type { Hono } from 'hono';
import { z } from 'zod';
import { executeDirective } from '../engine/moduleOps';
import { normalizeModules, playableModules } from '../engine/modules';
import { attachPicture, buildCharacterPortraitPrompt } from '../engine/world';
import { AppError } from '../errors';
import type { Painter } from '../images/types';
import type { SessionCoordinator } from '../sessionCoordinator';
import type { ImageStore } from '../store/imageStore';
import {
  newSessionId,
  recordSnapshot,
  rollbackSessionState,
  type SessionStore,
} from '../store/sessionStore';
import type { ResolvedSettings, SettingsStore } from '../store/settingsStore';
import {
  createSessionSchema,
  forkSchema,
  formatSessionResponse,
  generatePortraitSchema,
  importPayloadSchema,
  moduleOperationSchema,
  readBody,
  rollbackSchema,
  updateSessionSchema,
} from './schemas';

export interface SessionRouteDeps {
  sessions: SessionStore;
  settings: SettingsStore;
  images: ImageStore;
  coordinator: SessionCoordinator;
  makePainter: (settings: ResolvedSettings) => Painter | null;
}

export function registerSessionRoutes(app: Hono, deps: SessionRouteDeps): void {
  const { sessions, settings, images, coordinator, makePainter } = deps;

  app.get('/api/sessions', async (c) => c.json(await sessions.list()));

  app.post('/api/sessions', async (c) => {
    const request = await readBody(c, createSessionSchema);
    const created = await sessions.create(request, (await settings.get()).subscribedModules);
    return c.json(formatSessionResponse(c, created), 201);
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
    return c.json(formatSessionResponse(c, imported), 201);
  });

  app.get('/api/sessions/:id', async (c) => {
    const id = c.req.param('id');
    await coordinator.waitPending(id);
    const session = await sessions.get(id);
    if (!session) throw new AppError('not_found', 'No such session.');
    return c.json(formatSessionResponse(c, session));
  });

  app.get('/api/sessions/:id/export', async (c) => {
    const id = c.req.param('id');
    await coordinator.waitPending(id);
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
    coordinator.claim(id);
    try {
      await coordinator.waitPending(id);
      const session = await sessions.get(id);
      if (!session) throw new AppError('not_found', 'No such session.');
      rollbackSessionState(session, body.toTurn);
      await sessions.save(session);
      return c.json(formatSessionResponse(c, session));
    } finally {
      coordinator.release(id);
    }
  });

  app.post('/api/sessions/:id/fork', async (c) => {
    const id = c.req.param('id');
    const body = await readBody(c, forkSchema);
    await coordinator.waitPending(id);
    const session = await sessions.get(id);
    if (!session) throw new AppError('not_found', 'No such session.');
    const oldPrefix = `/api/images/${id}/`;
    const forked = await sessions.fork(session, body.upToTurn, (url, newId) =>
      url.startsWith(oldPrefix) ? `/api/images/${newId}/${url.slice(oldPrefix.length)}` : url,
    );
    await images.copySession(id, forked.id);
    return c.json(formatSessionResponse(c, forked), 201);
  });

  /**
   * Executes a structured module operation immediately on the server at zero
   * LLM token cost (e.g. ruling on a memorial, appointing an official, buying
   * a ware, assigning a steward, designating an heir, or ticking a clock).
   */
  app.post('/api/sessions/:id/actions', async (c) => {
    const id = c.req.param('id');
    const body = await readBody(c, moduleOperationSchema);
    coordinator.claim(id);
    try {
      await coordinator.waitPending(id);
      const session = await sessions.get(id);
      if (!session) throw new AppError('not_found', 'No such session.');
      if (session.world.turn <= 0) {
        throw new AppError('bad_request', 'The opening scene has not been generated yet.');
      }

      const { subscribedModules } = await settings.get();
      const activeModules = playableModules(session, subscribedModules);
      if (body.directive.op !== 'advisor_note' && !activeModules.includes(body.directive.moduleId)) {
        throw new AppError(
          'bad_request',
          `Module "${body.directive.moduleId}" is not active in this session.`,
        );
      }

      const report = executeDirective(session.world, body.directive);
      const createdAt = new Date().toISOString();
      const appended: Message[] = report.events.map(
        (event): EventMessage => ({
          id: randomUUID(),
          turn: session.world.turn,
          createdAt,
          kind: 'event',
          event,
        }),
      );
      if (appended.length > 0) {
        session.messages.push(...appended);
      }
      recordSnapshot(session);
      await sessions.save(session);

      const response: ModuleOperationResponse = {
        world: session.world,
        messages: appended,
        summary: report.summary,
        snapshotTurns: (session.snapshots ?? []).map((s) => s.turn),
      };
      return c.json(response);
    } finally {
      coordinator.release(id);
    }
  });

  app.post('/api/sessions/:id/images/:messageId/retry', async (c) => {
    const id = c.req.param('id');
    const messageId = c.req.param('messageId');
    await coordinator.waitPending(id);
    const session = coordinator.getActiveTurn(id)?.session ?? (await sessions.get(id));
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
    await coordinator.applySettledPicture(id, settled);
    const updated = coordinator.getActiveTurn(id)?.session ?? (await sessions.get(id)) ?? session;
    const response: RetryImageResponse = { message: settled, world: updated.world };
    return c.json(response);
  });

  app.post('/api/sessions/:id/characters/:characterId/portrait', async (c) => {
    const id = c.req.param('id');
    const characterId = c.req.param('characterId');
    const rawBody: unknown = await c.req.json().catch(() => ({}));
    const parsedBody = generatePortraitSchema.safeParse(rawBody ?? {});
    if (!parsedBody.success) throw new AppError('bad_request', z.prettifyError(parsedBody.error));

    await coordinator.waitPending(id);
    const session = coordinator.getActiveTurn(id)?.session ?? (await sessions.get(id));
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

    await coordinator.enqueue(id, async () => {
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

      const active = coordinator.getActiveTurn(id);
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

    const updated = coordinator.getActiveTurn(id)?.session ?? (await sessions.get(id)) ?? session;
    const response: GeneratePortraitResponse = { characterId, url, world: updated.world };
    return c.json(response);
  });

  app.patch('/api/sessions/:id', async (c) => {
    const id = c.req.param('id');
    const patch = await readBody(c, updateSessionSchema);
    coordinator.claim(id);
    try {
      await coordinator.waitPending(id);
      const session = await sessions.get(id);
      if (!session) throw new AppError('not_found', 'No such session.');
      const { subscribedModules } = await settings.get();
      const kept = session.modules.filter((modId) => !subscribedModules.includes(modId));
      session.modules = normalizeModules([...kept, ...patch.modules.filter((modId) => subscribedModules.includes(modId))]);
      session.modulesAuto = false;
      recordSnapshot(session);
      await sessions.save(session);
      return c.json(formatSessionResponse(c, session));
    } finally {
      coordinator.release(id);
    }
  });

  app.delete('/api/sessions/:id', async (c) => {
    const id = c.req.param('id');
    coordinator.claim(id);
    try {
      await coordinator.waitPending(id);
      if (!(await sessions.delete(id))) throw new AppError('not_found', 'No such session.');
      await images.deleteSession(id);
      return c.json({ ok: true });
    } finally {
      coordinator.release(id);
    }
  });

  app.get('/api/images/:sessionId/:file', async (c) => {
    const image = await images.read(c.req.param('sessionId'), c.req.param('file'));
    if (!image) throw new AppError('not_found', 'No such image.');
    return c.body(new Uint8Array(image.data), 200, {
      'Content-Type': image.contentType,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'X-Content-Type-Options': 'nosniff',
    });
  });
}
