import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEmptyWorld, type WorldState } from '@roleplay/shared';
import { rollDice } from './dice';
import { getTool, getToolSpecs, inExecutionOrder, type ToolContext } from './tools';
import { removeEntity, setScene, upsertCharacter, upsertItem, upsertLocation, upsertQuest, WorldOpError } from './world';

function worldWithPlayer(): WorldState {
  const world = createEmptyWorld();
  upsertLocation(world, { id: 'loc_inn', name: 'Inn' });
  setScene(world, { locationId: 'loc_inn' });
  upsertCharacter(world, {
    id: 'pc',
    name: 'Ash',
    isPlayer: true,
    stats: [{ name: 'HP', value: 20, max: 20 }],
  });
  return world;
}

test('characters appear in the current scene and are announced, the player is not', () => {
  const world = worldWithPlayer();
  assert.equal(world.playerId, 'pc');
  assert.equal(world.characters.pc?.locationId, 'loc_inn');

  const events = upsertCharacter(world, { id: 'npc_mara', name: 'Mara', role: 'Innkeeper' });
  assert.deepEqual(events, [{ type: 'character_added', id: 'npc_mara', name: 'Mara', role: 'Innkeeper' }]);
  assert.equal(world.characters.npc_mara?.locationId, 'loc_inn');
});

test('updating a character only changes the fields that were passed', () => {
  const world = worldWithPlayer();
  upsertCharacter(world, { id: 'npc_mara', name: 'Mara', role: 'Innkeeper', attitude: 'Wary' });
  upsertCharacter(world, { id: 'npc_mara', attitude: 'Friendly' });
  assert.equal(world.characters.npc_mara?.role, 'Innkeeper');
  assert.equal(world.characters.npc_mara?.attitude, 'Friendly');
});

test('stat changes are reported with the old and new value, and keep their max', () => {
  const world = worldWithPlayer();
  const events = upsertCharacter(world, { id: 'pc', stats: [{ name: 'HP', value: 14 }] });
  assert.deepEqual(events, [
    { type: 'stat_changed', characterId: 'pc', characterName: 'Ash', isPlayer: true, stat: 'HP', from: 20, to: 14, max: 20 },
  ]);
  upsertCharacter(world, { id: 'pc', stats: [{ name: 'HP', value: null }] });
  assert.deepEqual(world.characters.pc?.stats, []);
});

test('creating without a name is refused with a message the model can act on', () => {
  const world = worldWithPlayer();
  assert.throws(() => upsertCharacter(world, { id: 'npc_x', role: 'Guard' }), WorldOpError);
  assert.throws(() => setScene(world, { locationId: 'loc_nowhere' }), /upsert_location/);
});

test('items default to the player and report gains and losses by quantity', () => {
  const world = worldWithPlayer();
  assert.deepEqual(upsertItem(world, { id: 'coin', name: 'Coin', quantity: 5 }), [
    { type: 'item_gained', id: 'coin', name: 'Coin', quantity: 5 },
  ]);
  assert.deepEqual(upsertItem(world, { id: 'coin', quantity: 2 }), [
    { type: 'item_lost', id: 'coin', name: 'Coin', quantity: 3 },
  ]);
  upsertItem(world, { id: 'coin', quantity: 0 });
  assert.equal(world.items.coin, undefined);
});

test('items created before the player exists belong to nobody and announce nothing', () => {
  const world = createEmptyWorld();
  assert.deepEqual(upsertItem(world, { id: 'relic', name: 'Relic' }), []);
  assert.equal(world.items.relic?.ownerId, null);
  assert.deepEqual(removeEntity(world, 'item', 'relic'), []);
});

test('location connections run both ways, in either creation order', () => {
  const world = createEmptyWorld();
  upsertLocation(world, { id: 'a', name: 'A', connections: ['b'] });
  upsertLocation(world, { id: 'b', name: 'B' });
  assert.deepEqual(world.locations.b?.connections, ['a']);
  upsertLocation(world, { id: 'c', name: 'C', connections: ['a'] });
  assert.deepEqual(world.locations.a?.connections, ['b', 'c']);
});

test('moving the scene moves the player with it', () => {
  const world = worldWithPlayer();
  upsertLocation(world, { id: 'loc_road', name: 'Road' });
  const events = setScene(world, { locationId: 'loc_road', time: 'Dusk' });
  assert.deepEqual(events, [{ type: 'scene_changed', locationId: 'loc_road', locationName: 'Road' }]);
  assert.equal(world.characters.pc?.locationId, 'loc_road');
  assert.equal(world.scene.time, 'Dusk');
});

test('quests announce start, progress and completion', () => {
  const world = createEmptyWorld();
  assert.equal(upsertQuest(world, { id: 'q', title: 'Find him' })[0]?.type, 'quest_started');
  assert.equal(upsertQuest(world, { id: 'q', progress: 'Halfway' })[0]?.type, 'quest_updated');
  assert.equal(upsertQuest(world, { id: 'q', status: 'completed' })[0]?.type, 'quest_completed');
});

test('the player character cannot be removed', () => {
  const world = worldWithPlayer();
  assert.throws(() => removeEntity(world, 'character', 'pc'), WorldOpError);
});

test('dice notation', () => {
  assert.deepEqual(rollDice('2d6+1', () => 0), { notation: '2d6+1', rolls: [1, 1], modifier: 1, total: 3 });
  assert.equal(rollDice('d20', () => 0.999)?.total, 20);
  assert.equal(rollDice('banana'), null);
});

// --- the game master's tools ---------------------------------------------------

function toolContext() {
  const pictures: unknown[] = [];
  const told: string[] = [];
  return {
    pictures,
    told,
    ctx: {
      random: () => 0,
      narrate: (text: string) => void told.push(text),
      requestPicture: (request: unknown) => void pictures.push(request),
    },
  };
}

function record(world: WorldState, input: unknown, ctx: ToolContext = toolContext().ctx) {
  const tool = getTool('record');
  assert.ok(tool);
  return tool.run(world, input, ctx);
}

test('one record call builds a whole world, in dependency order whatever order it is written in', () => {
  const world = createEmptyWorld();
  const outcome = record(world, {
    // Listed back to front: the scene and the people refer to a place defined last.
    suggestions: ['Look around'],
    scene: { location_id: 'loc_inn', time: 'Dusk' },
    characters: [
      // The player is wrongly placed on the road, and Mara is given no place at all.
      { id: 'pc', name: 'Ash', is_player: true, location_id: 'loc_road', stats: [{ name: 'HP', value: 20, max: 20 }] },
      { id: 'npc_mara', name: 'Mara', role: 'Innkeeper' },
    ],
    items: [{ id: 'coin', name: 'Coin', quantity: 5 }],
    quests: [{ id: 'q', title: 'Find him' }],
    lore: [{ id: 'secret', title: 'What Mara knows', hidden: true }],
    locations: [{ id: 'loc_inn', name: 'Inn', connections: ['loc_road'] }, { id: 'loc_road', name: 'Road' }],
    world: { title: 'Lantern Road', art_style: 'watercolour' },
  });

  assert.equal(outcome.isError, false, outcome.content);
  assert.equal(world.title, 'Lantern Road');
  assert.equal(world.artStyle, 'watercolour');
  assert.equal(world.scene.locationId, 'loc_inn');
  // The player is where the scene is, and someone introduced without a place is in the scene too.
  assert.equal(world.characters.pc?.locationId, 'loc_inn');
  assert.equal(world.characters.npc_mara?.locationId, 'loc_inn');
  assert.equal(world.items.coin?.ownerId, 'pc');
  assert.deepEqual(world.locations.loc_road?.connections, ['loc_inn']);
  assert.deepEqual(world.suggestions, ['Look around']);
  assert.deepEqual(
    outcome.events.map((event) => event.type),
    ['world_named', 'location_added', 'location_added', 'scene_changed', 'character_added', 'item_gained', 'quest_started'],
  );
});

test('a bad entry is reported on its own and everything else in the record still applies', () => {
  const world = worldWithPlayer();
  const outcome = record(world, {
    characters: [
      { id: 'npc_a', name: 'A' },
      { name: 'No id' },
      { id: 'npc_b', name: 'B', mood: 'grim' },
      { id: 'npc_c', name: 'C', location_id: 'loc_nowhere' },
    ],
    weather: 'rain',
    suggestions: ['Go on'],
  });

  assert.equal(outcome.isError, true);
  const report = JSON.parse(outcome.content) as { rejected: { at: string }[] };
  assert.deepEqual(report.rejected.map((r) => r.at), ['characters[1]', 'characters[2]', 'characters[3]', 'weather']);
  assert.ok(world.characters.npc_a, 'the valid entry was applied');
  assert.deepEqual(world.suggestions, ['Go on']);
});

test('suggestions are required, since they are how the record ends the turn', () => {
  const outcome = record(worldWithPlayer(), { scene: { time: 'Noon' } });
  assert.equal(outcome.isError, true);
  assert.match(outcome.content, /suggestions/);
});

test('pictures are part of the record only when something can paint', () => {
  const sections = (illustrations: boolean) => {
    const spec = getToolSpecs({ illustrations }).find((s) => s.name === 'record');
    return Object.keys((spec?.inputSchema.properties ?? {}) as object);
  };
  assert.ok(sections(true).includes('pictures'));
  assert.ok(!sections(false).includes('pictures'));
  assert.deepEqual(getToolSpecs({ illustrations: false }).map((s) => s.name), ['narrate', 'roll_dice', 'record']);
});

test('a portrait needs a subject that exists; a scene needs nothing', () => {
  const world = worldWithPlayer();
  const { pictures, ctx } = toolContext();

  const outcome = record(
    world,
    {
      pictures: [
        { subject: 'character', id: 'npc_ghost', prompt: 'A ghost' },
        { subject: 'character', prompt: 'Nobody in particular' },
        { subject: 'scene', prompt: 'An inn at dusk', caption: 'Dusk' },
        { subject: 'character', id: 'pc', prompt: 'Ash, road-worn' },
      ],
      suggestions: ['Go on'],
    },
    ctx,
  );

  const report = JSON.parse(outcome.content) as { rejected: { at: string }[] };
  assert.deepEqual(report.rejected.map((r) => r.at), ['pictures[0]', 'pictures[1]']);
  assert.deepEqual(pictures, [
    { subject: 'scene', targetId: null, prompt: 'An inn at dusk', caption: 'Dusk' },
    { subject: 'character', targetId: 'pc', prompt: 'Ash, road-worn', caption: '' },
  ]);

  // With illustrations off the section is not offered, and is refused if sent anyway.
  const withoutPainter = { random: () => 0, narrate: () => {} };
  const refused = record(world, { pictures: [{ subject: 'scene', prompt: 'An inn' }], suggestions: ['Go on'] }, withoutPainter);
  assert.equal(refused.isError, true);
});

test('narrate and roll_dice validate their input', () => {
  const world = worldWithPlayer();
  const { told, ctx } = toolContext();
  const narrate = getTool('narrate');
  const roll = getTool('roll_dice');
  assert.ok(narrate && roll);

  assert.equal(narrate.run(world, { text: '' }, ctx).isError, true);
  assert.equal(narrate.run(world, { text: 'Rain falls.', mood: 'grim' }, ctx).isError, true);
  assert.equal(narrate.run(world, { text: 'Rain falls.' }, ctx).isError, false);
  assert.deepEqual(told, ['Rain falls.']);

  assert.equal(roll.run(world, { notation: 'banana', reason: 'Luck' }, ctx).isError, true);
  const rolled = roll.run(world, { notation: 'd20', reason: 'Luck' }, ctx);
  assert.deepEqual(JSON.parse(rolled.content), { rolls: [1], modifier: 0, total: 1 });
  assert.equal(rolled.events[0]?.type, 'dice_rolled');
});

test('tool schemas are plain JSON Schema objects', () => {
  for (const spec of getToolSpecs({ illustrations: true })) {
    assert.equal(spec.inputSchema.type, 'object', spec.name);
    assert.equal('$schema' in spec.inputSchema, false, spec.name);
  }
});

test('within one response the story is told before dice and record take effect', () => {
  const names = inExecutionOrder([{ name: 'record' }, { name: 'roll_dice' }, { name: 'narrate' }]).map((c) => c.name);
  assert.deepEqual(names, ['narrate', 'roll_dice', 'record']);
});

