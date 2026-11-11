import type { ModuleLibraryResponse } from '@roleplay/shared';
import type { Hono } from 'hono';
import {
  listLibrary,
  listPlugins,
  pluginManifestSchema,
  type PluginStore,
  registerPlugin,
  unregisterPlugin,
} from '../engine/modules';
import { AppError } from '../errors';
import type { SettingsStore } from '../store/settingsStore';
import { readBody } from './schemas';

export function registerModuleRoutes(app: Hono, settings: SettingsStore, plugins?: PluginStore): void {
  app.get('/api/modules', async (c) => {
    const body: ModuleLibraryResponse = { modules: listLibrary((await settings.get()).subscribedModules) };
    return c.json(body);
  });

  app.get('/api/plugins', (c) => c.json({ plugins: listPlugins() }));

  app.post('/api/plugins', async (c) => {
    const manifest = await readBody(c, pluginManifestSchema);
    const compiled = plugins ? await plugins.save(manifest) : registerPlugin(manifest);
    registerPlugin(compiled);
    const modules = listLibrary((await settings.get()).subscribedModules);
    return c.json({ plugin: compiled.manifest, modules }, 201);
  });

  app.delete('/api/plugins/:id', async (c) => {
    const id = c.req.param('id');
    const removedMem = unregisterPlugin(id);
    const removedDisk = plugins ? await plugins.remove(id) : false;
    if (!removedMem && !removedDisk) throw new AppError('not_found', `No plugin with id "${id}".`);
    const modules = listLibrary((await settings.get()).subscribedModules);
    return c.json({ ok: true, modules });
  });
}
