import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig, loadEnvFile } from './config';
import { PluginStore, registerPlugin } from './engine/modules';
import { ImageStore } from './store/imageStore';
import { SessionStore } from './store/sessionStore';
import { resolveRole, SettingsStore } from './store/settingsStore';

loadEnvFile();
const config = loadConfig();

const settings = new SettingsStore(config.dataDir);
const plugins = new PluginStore(config.dataDir);
void plugins.loadAll().then((loaded) => {
  for (const plugin of loaded) registerPlugin(plugin);
});

const app = createApp({
  sessions: new SessionStore(config.dataDir),
  settings,
  images: new ImageStore(config.dataDir),
  plugins,
  webDist: config.webDist,
});

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, async (info) => {
  const current = await settings.get();
  const gameMaster = resolveRole(current, 'gameMaster');
  const actor = resolveRole(current, 'actor');
  const describe = (role: typeof gameMaster) => [role.provider, role.model, role.effort].filter(Boolean).join(' · ');
  console.log(`RolePlay server listening on http://${config.host}:${info.port}`);
  console.log(`Game master: ${describe(gameMaster)}. Characters: ${describe(actor)}.`);
  console.log(`Illustrations: ${current.illustrationsActive ? 'on' : 'off'}. Data: ${config.dataDir}`);
});
