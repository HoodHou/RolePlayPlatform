import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { RetryImageResponse, Session, SessionBackup } from '@roleplay/shared';
import { createApp } from './app';
import { clearPlugins, PluginStore } from './engine/modules';
import { MockPainter } from './images/mock';
import { MockProvider } from './llm/mock';
import { ImageStore } from './store/imageStore';
import { SessionStore } from './store/sessionStore';
import { SettingsStore } from './store/settingsStore';

test('HTTP routes: turns record snapshots & usage, async illustrations settle, retry/rollback/fork/export/import and plugins work end-to-end', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'roleplay-app-'));
  try {
    clearPlugins();
    const sessions = new SessionStore(dataDir);
    const settings = new SettingsStore(dataDir, {});
    const images = new ImageStore(dataDir);
    const plugins = new PluginStore(dataDir);
    await plugins.loadAll();

    const app = createApp({
      sessions,
      settings,
      images,
      plugins,
      createProvider: () => new MockProvider({ delayMs: 0 }),
      createPainter: () => new MockPainter({ delayMs: 5 }),
    });

    // 1. Install a custom plugin via POST /api/plugins
    const pluginRes = await app.request('/api/plugins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'sanity',
        category: 'rules',
        glyph: '✦',
        name: { en: 'Sanity', zh: '理智' },
        tagline: { en: 'Mental strain.', zh: '精神负荷。' },
        description: { en: 'Sanity tracking.', zh: '理智追踪。' },
        guide: { en: 'Track sanity.', zh: '追踪理智。' },
        record: {
          description: 'Sanity state',
          fields: [{ key: 'stress', label: { en: 'Stress', zh: '压力' }, type: 'number', min: 0, max: 10 }],
        },
      }),
    });
    assert.equal(pluginRes.status, 201);

    // 2. Create session & run turn 1 (start) + turn 2 (action)
    const createRes = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: 'en', premise: 'A stormy lighthouse' }),
    });
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as Session;

    const turn1Res = await app.request(`/api/sessions/${created.id}/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'start' }),
    });
    assert.equal(turn1Res.status, 200);
    const sse1 = await turn1Res.text();
    assert.match(sse1, /event: done/);

    // Wait briefly for the background 5ms MockPainter to settle and persist
    await new Promise((r) => setTimeout(r, 40));

    const turn2Res = await app.request(`/api/sessions/${created.id}/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'action', text: 'Climb the spiral stairs' }),
    });
    assert.equal(turn2Res.status, 200);
    await turn2Res.text();
    await new Promise((r) => setTimeout(r, 40));

    const after2 = (await (await app.request(`/api/sessions/${created.id}`)).json()) as Session;
    assert.equal(after2.world.turn, 2);
    assert.ok((after2.snapshots?.length ?? 0) >= 3, 'snapshots for turns 0, 1, 2 are stored');

    // 3. Single-image retry endpoint repaints an illustration in place
    const firstImg = after2.messages.find((m) => m.kind === 'image');
    assert.ok(firstImg && firstImg.kind === 'image');
    assert.equal(firstImg.status, 'ready');
    const oldUrl = firstImg.url;

    const retryRes = await app.request(`/api/sessions/${created.id}/images/${firstImg.id}/retry`, {
      method: 'POST',
    });
    assert.equal(retryRes.status, 200);
    const retried = (await retryRes.json()) as RetryImageResponse;
    assert.equal(retried.message.status, 'ready');
    assert.notEqual(retried.message.url, oldUrl);

    // 4. Fork session at turn 1
    const forkRes = await app.request(`/api/sessions/${created.id}/fork`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ upToTurn: 1 }),
    });
    assert.equal(forkRes.status, 201);
    const forked = (await forkRes.json()) as Session;
    assert.notEqual(forked.id, created.id);
    assert.equal(forked.world.turn, 1);

    // 5. Rollback original session from turn 2 -> turn 1
    const rbRes = await app.request(`/api/sessions/${created.id}/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toTurn: 1 }),
    });
    assert.equal(rbRes.status, 200);
    const rolledBack = (await rbRes.json()) as Session;
    assert.equal(rolledBack.world.turn, 1);

    // 6. Export full backup & re-import as a brand-new save
    const exportRes = await app.request(`/api/sessions/${created.id}/export`);
    assert.equal(exportRes.status, 200);
    const backup = (await exportRes.json()) as SessionBackup;
    assert.equal(backup.version, 1);
    assert.ok(Object.keys(backup.images).length >= 1);

    const importRes = await app.request('/api/sessions/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backup),
    });
    assert.equal(importRes.status, 201);
    const imported = (await importRes.json()) as Session;
    assert.notEqual(imported.id, created.id);
    const importedImg = imported.messages.find((m) => m.kind === 'image');
    assert.ok(importedImg && importedImg.kind === 'image');
    assert.ok(importedImg.url?.startsWith(`/api/images/${imported.id}/`), 'imported image URLs point to the new session');

    // 7. Delete custom plugin
    const delPluginRes = await app.request('/api/plugins/sanity', { method: 'DELETE' });
    assert.equal(delPluginRes.status, 200);
  } finally {
    clearPlugins();
    await rm(dataDir, { recursive: true, force: true });
  }
});
