import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ImageStore } from './imageStore';
import { readJson, writeJson } from './jsonFile';
import { newSessionId, recordSnapshot, rollbackSessionState, SessionStore } from './sessionStore';

test('a save from before characters had minds loads with empty ones', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'roleplay-'));
  try {
    // A session as an earlier version wrote it: no artStyle, no voice, goals, secrets or memories.
    const old = {
      id: 'oldsave1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      language: 'en',
      seed: { premise: '', playerName: '', playerConcept: '' },
      world: {
        title: 'Old World',
        premise: '',
        scene: { locationId: null, time: '', weather: '', summary: '' },
        playerId: 'pc',
        characters: {
          pc: { id: 'pc', name: 'Ash', isPlayer: true, role: '', description: '', personality: '', status: '', attitude: '', locationId: null, stats: [] },
          npc: { id: 'npc', name: 'Mara', isPlayer: false, role: '', description: '', personality: '', status: '', attitude: 'Wary', locationId: null, stats: [] },
        },
        locations: {},
        items: {},
        quests: {},
        lore: {},
        suggestions: [],
        turn: 4,
      },
      messages: [],
    };
    await mkdir(path.join(dataDir, 'sessions'));
    await writeFile(path.join(dataDir, 'sessions', 'oldsave1.json'), JSON.stringify(old));

    const session = await new SessionStore(dataDir).get('oldsave1');

    assert.equal(session?.world.artStyle, '');
    const npc = session?.world.characters.npc;
    assert.deepEqual([npc?.voice, npc?.goals, npc?.secrets, npc?.memories], ['', '', '', []]);
    assert.equal(npc?.attitude, 'Wary', 'what was there is kept');
    assert.equal(session?.world.storySummary, '');
    assert.equal(session?.world.summarizedUpToTurn, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('writeJson handles concurrent writes to the same path without temp-file collisions', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'roleplay-json-'));
  try {
    const file = path.join(dataDir, 'concurrent.json');
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => writeJson(file, { seq: i, label: `item-${i}` })),
    );
    const final = await readJson<{ seq: number; label: string }>(file);
    assert.ok(final !== null);
    assert.equal(final.label, `item-${final.seq}`);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('SessionStore summary cache stays consistent across create, save, fork, rollback, and delete', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'roleplay-store-'));
  try {
    const store = new SessionStore(dataDir);
    const created = await store.create({ language: 'zh', premise: '雨夜客栈' }, ['dice']);
    recordSnapshot(created);

    created.world.title = '风雪夜归人';
    created.world.turn = 1;
    created.messages.push({
      id: 'm1',
      turn: 1,
      createdAt: new Date().toISOString(),
      kind: 'narration',
      text: '风雪推开了木门。',
    });
    recordSnapshot(created);

    created.world.turn = 2;
    created.world.title = '第二幕';
    created.messages.push(
      { id: 'p2', turn: 2, createdAt: new Date().toISOString(), kind: 'player', text: '拔剑' },
      { id: 'm2', turn: 2, createdAt: new Date().toISOString(), kind: 'narration', text: '剑光一闪。' },
    );
    recordSnapshot(created);
    await store.save(created);

    const list1 = await store.list();
    assert.equal(list1.length, 1);
    assert.equal(list1[0]?.title, '第二幕');
    assert.equal(list1[0]?.turn, 2);

    // Fork at historical turn 1
    const forked = await store.fork(created, 1);
    assert.notEqual(forked.id, created.id);
    assert.equal(forked.world.turn, 1);
    assert.equal(forked.world.title, '风雪夜归人');
    assert.equal(forked.messages.length, 1);

    // Rollback original to turn 1
    rollbackSessionState(created, 1);
    await store.save(created);
    assert.equal(created.world.turn, 1);
    assert.equal(created.world.title, '风雪夜归人');

    const list2 = await store.list();
    assert.equal(list2.length, 2);

    assert.equal(await store.delete(forked.id), true);
    const list3 = await store.list();
    assert.equal(list3.length, 1);
    assert.equal(list3[0]?.id, created.id);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('ImageStore exports and imports PNG and SVG illustrations under safe filenames', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'roleplay-img-'));
  try {
    const images = new ImageStore(dataDir);
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);
    const svgBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8');

    const idA = newSessionId();
    const idB = newSessionId();
    const pngUrl = await images.save(idA, { data: pngBytes, extension: 'png' });
    const svgUrl = await images.save(idA, { data: svgBytes, extension: 'svg' });

    const exported = await images.exportSession(idA);
    assert.equal(Object.keys(exported).length, 2);

    const urlMap = await images.importSession(idB, exported);
    const oldPngFile = pngUrl.split('/').pop()!;
    const oldSvgFile = svgUrl.split('/').pop()!;
    assert.ok(urlMap.get(oldPngFile)?.startsWith(`/api/images/${idB}/`));
    assert.ok(urlMap.get(oldPngFile)?.endsWith('.png'));
    assert.ok(urlMap.get(oldSvgFile)?.endsWith('.svg'));

    const loadedPng = await images.read(idB, urlMap.get(oldPngFile)!.split('/').pop()!);
    assert.equal(loadedPng?.contentType, 'image/png');
    assert.deepEqual(loadedPng?.data, pngBytes);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
