import type { ErrorResponse } from '@roleplay/shared';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { PluginStore } from './engine/modules';
import { toAppError } from './errors';
import { createPainter } from './images';
import type { Painter } from './images/types';
import { createProvider } from './llm';
import type { LLMProvider } from './llm/types';
import { registerModuleRoutes } from './routes/modules';
import { registerScenarioRoutes } from './routes/scenarios';
import { registerSessionRoutes } from './routes/sessions';
import { registerSettingsRoutes } from './routes/settings';
import { registerTurnRoutes } from './routes/turns';
import { SessionCoordinator } from './sessionCoordinator';
import { serveWebApp } from './static';
import type { ImageStore } from './store/imageStore';
import type { SessionStore } from './store/sessionStore';
import type { ResolvedSettings, SettingsStore } from './store/settingsStore';

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

export function createApp(deps: AppDeps): Hono {
  const { sessions, settings, images } = deps;
  const makeProvider = deps.createProvider ?? createProvider;
  const makePainter = deps.createPainter ?? createPainter;
  const coordinator = new SessionCoordinator(sessions);

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

  registerSettingsRoutes(app, settings);
  registerModuleRoutes(app, settings, deps.plugins);
  registerScenarioRoutes(app, settings, makeProvider);
  registerSessionRoutes(app, { sessions, settings, images, coordinator, makePainter });
  registerTurnRoutes(app, { sessions, settings, images, coordinator, makeProvider, makePainter });

  if (deps.webDist) serveWebApp(app, deps.webDist);
  return app;
}
