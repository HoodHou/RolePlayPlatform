import { MODEL_LIST_TARGETS, type ModelListResponse } from '@roleplay/shared';
import type { Hono } from 'hono';
import { z } from 'zod';
import { AppError } from '../errors';
import { listModels } from '../llm/models';
import type { SettingsStore } from '../store/settingsStore';
import { toPublicSettings } from '../store/settingsStore';
import { readBody, settingsSchema } from './schemas';

export function registerSettingsRoutes(app: Hono, settings: SettingsStore): void {
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
}
