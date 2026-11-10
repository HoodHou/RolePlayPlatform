import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig, loadEnvFile } from './config';
import { ImageStore } from './store/imageStore';
import { SessionStore } from './store/sessionStore';
import { SettingsStore } from './store/settingsStore';

loadEnvFile();
const config = loadConfig();

const settings = new SettingsStore(config.dataDir);
const app = createApp({
  sessions: new SessionStore(config.dataDir),
  settings,
  images: new ImageStore(config.dataDir),
  webDist: config.webDist,
});

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, async (info) => {
  const { activeProvider, illustrationsActive } = await settings.get();
  console.log(`RolePlay server listening on http://${config.host}:${info.port}`);
  console.log(`Game master: ${activeProvider}. Illustrations: ${illustrationsActive ? 'on' : 'off'}. Data: ${config.dataDir}`);
});
