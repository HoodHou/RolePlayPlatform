import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { SessionStore } from './sessionStore';

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
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
