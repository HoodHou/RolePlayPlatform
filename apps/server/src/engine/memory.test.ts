import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEmptyWorld, type Memory, type WorldState } from '@roleplay/shared';
import { gameMasterView, mentionedIds, recall, sceneFocus } from './memory';
import { getToolbox } from './tools';
import { addMemory, setScene, upsertCharacter, upsertLocation, WorldOpError } from './world';

function world(): WorldState {
  const w = createEmptyWorld();
  upsertLocation(w, { id: 'loc_inn', name: 'The Drowned Lantern', connections: ['loc_road'] });
  upsertLocation(w, { id: 'loc_road', name: 'Marsh Road' });
  setScene(w, { locationId: 'loc_inn', time: 'Dusk' });
  upsertCharacter(w, { id: 'pc', name: 'Ash', isPlayer: true });
  upsertCharacter(w, { id: 'npc_mara', name: 'Mara', role: 'Innkeeper', secrets: 'Hides the courier.' });
  upsertCharacter(w, { id: 'npc_far', name: 'Odo', locationId: 'loc_road' });
  w.turn = 1;
  return w;
}

function memory(overrides: Partial<Memory>): Memory {
  return { id: 'm', turn: 1, time: '', locationId: null, text: '', about: [], importance: 2, ...overrides };
}

test('a memory is stamped with when and where the character was, and is not announced', () => {
  const w = world();
  const events = addMemory(w, { characterId: 'npc_mara', text: ' A traveller came in. ', about: ['pc'], importance: 3 });

  assert.deepEqual(events, []);
  const memories = (): Memory[] => w.characters.npc_mara?.memories ?? [];
  assert.deepEqual(memories(), [
    { id: 'm1_0', turn: 1, time: 'Dusk', locationId: 'loc_inn', text: 'A traveller came in.', about: ['pc'], importance: 3 },
  ]);

  addMemory(w, { characterId: 'npc_mara', text: 'They asked about the courier.', toldBy: 'npc_far', importance: 9 });
  const second = memories()[1];
  assert.equal(second?.id, 'm1_1');
  assert.equal(second?.toldBy, 'npc_far');
  assert.equal(second?.importance, 5, 'importance is kept within 1–5');
});

test('only characters in the story remember; the player character does not', () => {
  const w = world();
  assert.throws(() => addMemory(w, { characterId: 'pc', text: 'I remember.' }), WorldOpError);
  assert.throws(() => addMemory(w, { characterId: 'npc_ghost', text: 'Boo.' }), WorldOpError);
  assert.throws(() => addMemory(w, { characterId: 'npc_mara', text: 'Heard it.', toldBy: 'npc_ghost' }), WorldOpError);
});

test('the record gives each witness their own memory, and a bad one does not sink the rest', () => {
  const w = world();
  const record = getToolbox({ illustrations: false, modules: [] }).get('record');
  assert.ok(record);

  const outcome = record.run(
    w,
    {
      memories: [
        { character_id: 'npc_mara', text: 'The traveller paid in old coin.', about: ['pc'], importance: 2 },
        { character_id: 'pc', text: 'The player has no memories here.' },
        { character_id: 'npc_far', text: 'Mara told me a traveller is asking questions.', told_by: 'npc_mara' },
      ],
      suggestions: ['Go on'],
    },
    { random: () => 0, narrate: () => {} },
  );

  const report = JSON.parse(outcome.content) as { rejected: { at: string }[] };
  assert.deepEqual(report.rejected.map((r) => r.at), ['memories[1]']);
  assert.equal(w.characters.npc_mara?.memories.length, 1);
  assert.equal(w.characters.npc_far?.memories[0]?.toldBy, 'npc_mara');
  // Stamped where the listener was, not where the scene is.
  assert.equal(w.characters.npc_far?.memories[0]?.locationId, 'loc_road');
});

test('recall favours what is recent, what mattered and who is here, and keeps the order things happened in', () => {
  const memories = [
    memory({ id: 'old-trivial', turn: 1, importance: 1 }),
    memory({ id: 'old-vital', turn: 1, importance: 5 }),
    memory({ id: 'old-about-them', turn: 2, importance: 1, about: ['npc_mara'] }),
    memory({ id: 'mid-trivial', turn: 20, importance: 1 }),
    memory({ id: 'fresh-trivial', turn: 40, importance: 1 }),
  ];
  const focus = { cues: new Set<string>(), around: new Set(['npc_mara']), turn: 40 };

  assert.deepEqual(
    recall(memories, focus, 3).map((m) => m.id),
    ['old-vital', 'old-about-them', 'fresh-trivial'],
  );
  // Nothing to choose between when everything fits.
  assert.equal(recall(memories, focus, 10), memories);
});

test('being asked about something recalls it past any number of fresher, weightier memories', () => {
  const memories = [
    memory({ id: 'cellar-long-ago', turn: 1, importance: 1, about: ['loc_cellar'] }),
    memory({ id: 'heard-of-cellar', turn: 3, importance: 1, toldBy: 'npc_odo' }),
    ...Array.from({ length: 30 }, (_, i) => memory({ id: `today-${i}`, turn: 50, importance: 4, about: ['pc'] })),
  ];
  const around = new Set(['pc']);

  const unprompted = recall(memories, { cues: new Set(), around, turn: 50 }, 6).map((m) => m.id);
  assert.ok(unprompted.every((id) => id.startsWith('today-')));

  const asked = recall(memories, { cues: new Set(['loc_cellar', 'npc_odo']), around, turn: 50 }, 6).map((m) => m.id);
  assert.deepEqual(asked.slice(0, 2), ['cellar-long-ago', 'heard-of-cellar']);
  assert.equal(asked.length, 6, 'the rest of the places still go to what weighs most');
});

test('what the player says names the things it brings up; the scene supplies who is here', () => {
  const w = world();
  assert.deepEqual(mentionedIds(w, 'I ask about the marsh road and about Odo.'), ['npc_far', 'loc_road']);
  assert.deepEqual(mentionedIds(w, ''), []);

  const focus = sceneFocus(w, 'Where is Odo?');
  assert.deepEqual([...focus.cues], ['npc_far']);
  assert.deepEqual([...focus.around].sort(), ['loc_inn', 'npc_mara', 'pc']);
});

test('the game master sees the memories of whoever is in play, and only a count for the rest', () => {
  const w = world();
  for (let i = 0; i < 12; i++) addMemory(w, { characterId: 'npc_mara', text: `Evening ${i}.`, about: ['pc'] });
  addMemory(w, { characterId: 'npc_far', text: 'Rain on the causeway.' });

  const view = gameMasterView(w, 'I order stew.') as { characters: Record<string, { memories: unknown[]; memories_not_shown?: number; secrets: string }> };

  assert.equal(view.characters.npc_mara?.memories.length, 8);
  assert.equal(view.characters.npc_mara?.memories_not_shown, 4);
  // The game master, unlike an actor, is shown everyone's secrets.
  assert.equal(view.characters.npc_mara?.secrets, 'Hides the courier.');
  assert.deepEqual(view.characters.npc_far?.memories, []);
  assert.equal(view.characters.npc_far?.memories_not_shown, 1);
  // The stored world is untouched: the view is a copy for the prompt.
  assert.equal(w.characters.npc_mara?.memories.length, 12);

  const named = gameMasterView(w, 'I ask Mara about Odo.') as typeof view;
  assert.equal(named.characters.npc_far?.memories.length, 1);
});

test('mentionedIds and recall match Chinese partial names, quests/lore, and direct memory text cues', () => {
  const w = world();
  upsertCharacter(w, { id: 'npc_shen', name: '沈墨轩', locationId: 'loc_road' });
  w.quests.q_seal = { id: 'q_seal', title: '失落的虎符', description: '', progress: '', status: 'active' };
  w.lore.l_sect = { id: 'l_sect', title: '天机阁旧事', content: '', hidden: false };
  w.storySummary = '三日前主角初入青州城。';
  w.summarizedUpToTurn = 6;

  // Partial 2-char Chinese bigram ("沈墨", "虎符", "天机") matches 3+ char names/titles
  const ids = mentionedIds(w, '向掌柜打听沈墨和虎符、天机的下落');
  assert.ok(ids.includes('npc_shen'));
  assert.ok(ids.includes('q_seal'));
  assert.ok(ids.includes('l_sect'));

  // Direct text recall surfaces an untagged old memory whose text matches the query
  const memories = [
    memory({ id: 'secret-letter', turn: 1, importance: 1, text: '看到黑衣人把密信藏在酒窖砖缝里。' }),
    ...Array.from({ length: 15 }, (_, i) =>
      memory({ id: `chat-${i}`, turn: 30, importance: 3, text: `日常闲聊 ${i}`, about: ['pc'] }),
    ),
  ];
  const recalled = recall(
    memories,
    { cues: new Set(), around: new Set(['pc']), turn: 30, query: '酒窖里的密信在哪' },
    4,
  );
  assert.equal(recalled[0]?.id, 'secret-letter');

  // gameMasterView exposes storySummary when non-empty and hides internal summarizedUpToTurn
  const view = gameMasterView(w, '四处看看') as Record<string, unknown>;
  assert.equal(view.storySummary, '三日前主角初入青州城。');
  assert.equal('summarizedUpToTurn' in view, false);
});
