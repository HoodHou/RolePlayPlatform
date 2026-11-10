import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  createEmptyWorld,
  MODULE_IDS,
  type ModuleId,
  type Session,
  type TurnEvent,
  type WorldEvent,
  type WorldState,
} from '@roleplay/shared';
import { createApp } from '../../app';
import { MockProvider } from '../../llm/mock';
import { NO_USAGE, type Conversation, type LLMProvider, type StepResult, type ToolResult } from '../../llm/types';
import { ImageStore } from '../../store/imageStore';
import { SessionStore } from '../../store/sessionStore';
import { SettingsStore } from '../../store/settingsStore';
import { buildActorInit } from '../actor';
import { runTurn } from '../gameMaster';
import { gameMasterView } from '../memory';
import { getPrompts } from '../prompts';
import { getToolbox, type ToolContext } from '../tools';
import { setScene, upsertCharacter, upsertLocation } from '../world';
import { resolveCheck } from './dice';
import { resolveBattle } from './sandbox';

/** A random source that makes dice of `sides` sides come up with these faces, in order (the last one repeats). */
function faces(sides: number, ...values: number[]): () => number {
  let next = 0;
  return () => ((values[Math.min(next++, values.length - 1)] ?? 1) - 0.5) / sides;
}

const everything = getToolbox({ illustrations: false, modules: MODULE_IDS });

function run(name: string, world: WorldState, input: unknown, random: () => number = faces(20, 10)) {
  const tool = everything.get(name);
  assert.ok(tool, name);
  const ctx: ToolContext = { random, narrate: () => {} };
  const outcome = tool.run(world, input, ctx);
  let report: unknown = outcome.content;
  try {
    report = JSON.parse(outcome.content);
  } catch {
    // Plain-text results are compared as they are.
  }
  return { ...outcome, report: report as Record<string, never> };
}

const types = (events: WorldEvent[]) => events.map((event) => event.type);
const rejectedAt = (report: unknown) => ((report as { rejected?: { at: string }[] }).rejected ?? []).map((entry) => entry.at);

function worldWithPlayer(): WorldState {
  const world = createEmptyWorld();
  upsertLocation(world, { id: 'loc_hall', name: 'Hall' });
  setScene(world, { locationId: 'loc_hall' });
  upsertCharacter(world, {
    id: 'pc',
    name: 'Ash',
    isPlayer: true,
    stats: [
      { name: 'Stealth', value: 4 },
      { name: 'Nerve', value: 'Steady' },
    ],
  });
  return world;
}

// --- dice ---------------------------------------------------------------------

test('d20: the die plus the stat must meet the difficulty; a natural 20 or 1 overrides the sum', () => {
  const check = (value: number, random: () => number, extra = {}) =>
    resolveCheck('d20', { value, difficulty: 'normal', modifier: 0, ...extra }, random);

  assert.deepEqual(check(3, faces(20, 9)), { rolls: [9], kept: [9], bonus: 3, total: 12, target: 12, outcome: 'success' });
  assert.equal(check(3, faces(20, 8)).outcome, 'failure');
  assert.equal(check(3, faces(20, 9), { difficulty: 'hard' }).outcome, 'failure');
  assert.equal(check(3, faces(20, 9), { modifier: 4, difficulty: 'hard' }).outcome, 'success');
  assert.equal(check(-9, faces(20, 20)).outcome, 'critical');
  assert.equal(check(30, faces(20, 1)).outcome, 'fumble');

  // An edge rolls two dice and keeps the better or the worse.
  assert.deepEqual(check(0, faces(20, 4, 17), { edge: 'advantage' }).kept, [17]);
  assert.deepEqual(check(0, faces(20, 4, 17), { edge: 'disadvantage' }).kept, [4]);
});

test('d100: the roll must come in at or under the stat; harder attempts shrink the chance', () => {
  const check = (roll: number, difficulty: 'easy' | 'normal' | 'hard' | 'extreme' = 'normal', value = 60) =>
    resolveCheck('d100', { value, difficulty, modifier: 0 }, faces(100, roll));

  assert.deepEqual(check(60), { rolls: [60], kept: [60], bonus: 0, total: 60, target: 60, outcome: 'success' });
  assert.equal(check(61).outcome, 'failure');
  assert.equal(check(30, 'hard').target, 30);
  assert.equal(check(30, 'extreme').target, 12);
  assert.equal(check(30, 'easy').target, 80);
  assert.equal(check(1, 'extreme', 2).outcome, 'critical');
  assert.equal(check(100, 'normal', 99).outcome, 'fumble');
  // 96 and up is a fumble only for those with less than an even chance.
  assert.equal(check(96, 'normal', 40).outcome, 'fumble');
  assert.equal(check(96, 'normal', 60).outcome, 'failure');
  // Rolling under, so advantage keeps the lower die.
  const lucky = resolveCheck('d100', { value: 50, difficulty: 'normal', modifier: 0, edge: 'advantage' }, faces(100, 80, 20));
  assert.deepEqual([lucky.kept, lucky.outcome], [[20], 'success']);
});

test('2d6: ten succeeds, seven to nine succeeds at a cost', () => {
  const check = (value: number, random: () => number, extra = {}) =>
    resolveCheck('2d6', { value, difficulty: 'normal', modifier: 0, ...extra }, random);

  assert.deepEqual(check(1, faces(6, 3, 4)), { rolls: [3, 4], kept: [3, 4], bonus: 1, total: 8, target: 10, outcome: 'partial' });
  assert.equal(check(0, faces(6, 5, 5)).outcome, 'success');
  assert.equal(check(0, faces(6, 2, 3)).outcome, 'failure');
  assert.equal(check(-3, faces(6, 6, 6)).outcome, 'critical');
  assert.equal(check(9, faces(6, 1, 1)).outcome, 'fumble');
  // A hard attempt is rolled at one less.
  assert.equal(check(1, faces(6, 4, 5), { difficulty: 'hard' }).total, 9);
  assert.deepEqual(check(0, faces(6, 1, 5, 6), { edge: 'advantage' }).kept, [5, 6]);
  assert.deepEqual(check(0, faces(6, 1, 5, 6), { edge: 'disadvantage' }).kept, [1, 5]);
});

test('a check reads the stat off the sheet, and says so when the sheet has no such number', () => {
  const world = worldWithPlayer();

  const sneak = run('check', world, { stat: 'stealth', reason: 'Slip past the guard' }, faces(20, 10));
  assert.equal(sneak.isError, false);
  assert.deepEqual(sneak.report, { system: 'd20', rolls: [10], kept: [10], bonus: 4, total: 14, target: 12, outcome: 'success' });
  assert.deepEqual(sneak.events, [
    {
      type: 'check_rolled',
      characterId: 'pc',
      characterName: 'Ash',
      isPlayer: true,
      // Asked for as "stealth"; reported the way the sheet spells it.
      stat: 'Stealth',
      system: 'd20',
      difficulty: 'normal',
      rolls: [10],
      kept: [10],
      bonus: 4,
      total: 14,
      target: 12,
      outcome: 'success',
      reason: 'Slip past the guard',
    },
  ]);
  // The first check settles the rules the player is shown.
  assert.deepEqual(world.modules.dice, { system: 'd20' });

  // "Nerve" is on the sheet, but as a word.
  const nerve = run('check', world, { stat: 'Nerve', reason: 'Hold steady' });
  assert.equal(nerve.isError, true);
  assert.match(nerve.content, /Stealth/);
  assert.equal(nerve.events.length, 0);

  // A number passed along stands in for a stat the sheet lacks; no stat at all is a flat roll.
  const lore = run('check', world, { stat: 'Lore', value: 2, reason: 'Recall the legend' });
  assert.equal(lore.report.bonus, 2);
  assert.equal(lore.events[0]?.type === 'check_rolled' && lore.events[0].stat, 'Lore');
  assert.equal(run('check', world, { reason: 'Pure luck' }).report.bonus, 0);
  assert.equal(run('check', world, { character_id: 'npc_nobody', reason: 'Who?' }).isError, true);
});

test('the dice rules are chosen in the record and decide how checks are rolled', () => {
  const world = worldWithPlayer();
  const chosen = run('record', world, { dice: { system: 'd100' }, suggestions: ['Go on'] });
  assert.equal(chosen.isError, false);
  assert.deepEqual(world.modules.dice, { system: 'd100' });

  const check = run('check', world, { stat: 'Stealth', value: 55, reason: 'Slip past' }, faces(100, 3));
  // The sheet's own number wins over one passed along: 4%, and a 3 comes in under it.
  assert.deepEqual([check.report.system, check.report.target, check.report.outcome], ['d100', 4, 'success']);
  // A percentile roll needs a percentage to roll against.
  assert.equal(run('check', world, { reason: 'Pure luck' }).isError, true);

  const bad = run('record', world, { dice: { system: 'd7', house_rule: true }, suggestions: ['Go on'] });
  assert.deepEqual(rejectedAt(bad.report), ['dice.system', 'dice.house_rule']);
  assert.deepEqual(world.modules.dice, { system: 'd100' });
});

// --- sandbox ------------------------------------------------------------------

const BOARD = {
  period: 'Spring, year 1',
  resources: [
    { id: 'gold', name: 'Gold' },
    { id: 'troops', name: 'Troops' },
  ],
  factions: [
    {
      id: 'f_aren',
      name: 'Aren',
      is_player: true,
      resources: [
        { id: 'gold', value: 100 },
        { id: 'troops', value: 50 },
      ],
      income: [
        { id: 'gold', value: 10 },
        { id: 'troops', value: -60 },
      ],
    },
    { id: 'f_vesk', name: 'Vesk', resources: [{ id: 'troops', value: 40 }] },
  ],
  regions: [
    { id: 'r_keep', name: 'Keep', owner_id: 'f_aren', x: 2, y: 2, neighbors: ['r_ford'], strength: 3 },
    // Asks for the cell the keep already has.
    { id: 'r_ford', name: 'Ford', owner_id: 'f_vesk', x: 2, y: 2 },
    // Asks for no cell at all.
    { id: 'r_fens', name: 'Fens' },
  ],
  relations: [{ a: 'f_vesk', b: 'f_aren', stance: 'hostile', note: 'Raids at the ford.' }],
};

function worldWithBoard(): WorldState {
  const world = worldWithPlayer();
  const outcome = run('record', world, { sandbox: BOARD, suggestions: ['Go on'] });
  assert.equal(outcome.content, 'ok');
  return world;
}

test('the board is set up in one record: factions, regions on the map, relations', () => {
  const world = worldWithPlayer();
  const outcome = run('record', world, { sandbox: BOARD, suggestions: ['Go on'] });

  assert.equal(outcome.content, 'ok');
  // Starting stock is not news; new powers and how they stand are.
  assert.deepEqual(outcome.events, [
    { type: 'faction_added', id: 'f_aren', name: 'Aren' },
    { type: 'faction_added', id: 'f_vesk', name: 'Vesk' },
    { type: 'relation_changed', aName: 'Aren', bName: 'Vesk', stance: 'hostile' },
  ]);

  const board = world.modules.sandbox;
  assert.ok(board);
  assert.deepEqual([board.round, board.period], [0, 'Spring, year 1']);
  assert.deepEqual([board.factions.f_aren?.color, board.factions.f_vesk?.color], [0, 1]);
  assert.deepEqual(board.factions.f_aren?.resources, { gold: 100, troops: 50 });
  assert.deepEqual(board.relations, [{ a: 'f_aren', b: 'f_vesk', stance: 'hostile', note: 'Raids at the ford.' }]);

  const { r_keep: keep, r_ford: ford, r_fens: fens } = board.regions;
  assert.deepEqual([keep?.x, keep?.y], [2, 2]);
  // No two regions share a cell: the ford went to the nearest free one, the fens beside it.
  const cells = new Set(Object.values(board.regions).map((region) => `${region.x},${region.y}`));
  assert.equal(cells.size, 3);
  assert.equal(Math.abs((ford?.x ?? 0) - 2) + Math.abs((ford?.y ?? 0) - 2), 1);
  assert.ok(fens);
  // Borders run both ways.
  assert.deepEqual(ford?.neighbors, ['r_keep']);
});

test('changes to the board are announced: land changing hands, relations, what the player\'s side has', () => {
  const world = worldWithBoard();
  const outcome = run('record', world, {
    sandbox: {
      factions: [
        { id: 'f_aren', status: 'On the march', resources: [{ id: 'gold', change: -30 }] },
        // Not the player's side: recorded, not announced.
        { id: 'f_vesk', resources: [{ id: 'troops', change: 15 }] },
      ],
      regions: [{ id: 'r_fens', owner_id: 'f_aren' }],
      relations: [{ a: 'f_aren', b: 'f_vesk', stance: 'war' }],
    },
    suggestions: ['Go on'],
  });

  assert.equal(outcome.content, 'ok');
  assert.deepEqual(outcome.events, [
    { type: 'resource_changed', factionId: 'f_aren', factionName: 'Aren', resource: 'Gold', from: 100, to: 70 },
    { type: 'region_taken', regionId: 'r_fens', regionName: 'Fens', fromId: null, fromName: '', toId: 'f_aren', toName: 'Aren' },
    { type: 'relation_changed', aName: 'Aren', bName: 'Vesk', stance: 'war' },
  ]);
  assert.equal(world.modules.sandbox?.factions.f_vesk?.resources.troops, 55);
  assert.equal(world.modules.sandbox?.relations[0]?.note, 'Raids at the ford.', 'a note survives a change of stance');
});

test('a bad entry on the board is refused on its own; a fallen faction leaves its lands open', () => {
  const world = worldWithBoard();
  const outcome = run('record', world, {
    sandbox: {
      factions: [{ id: 'f_aren', resources: [{ id: 'iron', value: 3 }] }],
      regions: [
        { id: 'r_new', name: 'Mill', owner_id: 'f_nobody' },
        { id: 'r_fens', terrain: 'marsh' },
      ],
      armies: [],
      remove: [{ kind: 'faction', id: 'f_vesk', reason: 'Its king fled.' }],
    },
    suggestions: ['Go on'],
  });

  assert.equal(outcome.isError, true);
  assert.deepEqual(rejectedAt(outcome.report), ['sandbox.factions[0]', 'sandbox.regions[0]', 'sandbox.armies']);
  const board = world.modules.sandbox;
  assert.equal(board?.regions.r_fens?.terrain, 'marsh', 'the entries that were fine went in');
  assert.deepEqual(outcome.events, [{ type: 'faction_removed', id: 'f_vesk', name: 'Vesk', reason: 'Its king fled.' }]);
  assert.equal(board?.regions.r_ford?.ownerId, null);
  assert.deepEqual(board?.relations, []);

  // A section with nothing in it sets no board up.
  const fresh = worldWithPlayer();
  run('record', fresh, { sandbox: {}, suggestions: ['Go on'] });
  assert.equal(fresh.modules.sandbox, undefined);
});

test('a rejected faction leaves no trace on the board', () => {
  const world = worldWithBoard();
  const before = structuredClone(world.modules.sandbox);

  // The second holding names a resource nobody defined: the whole entry is refused, not half of it.
  const outcome = run('record', world, {
    sandbox: {
      factions: [
        { id: 'f_wei', name: 'Wei', is_player: true, status: 'Rising', resources: [{ id: 'gold', value: 100 }, { id: 'iron', value: 50 }] },
        { id: 'f_aren', status: 'Confident', income: [{ id: 'iron', value: 5 }] },
      ],
    },
    suggestions: ['Go on'],
  });

  assert.deepEqual(rejectedAt(outcome.report), ['sandbox.factions[0]', 'sandbox.factions[1]']);
  assert.deepEqual(outcome.events, []);
  assert.deepEqual(world.modules.sandbox, before, 'no ghost faction, and the player is still on the side they were on');

  // Sent again with the resource defined, it is a new faction like any other.
  const again = run('record', world, {
    sandbox: {
      resources: [{ id: 'iron', name: 'Iron' }],
      factions: [{ id: 'f_wei', name: 'Wei', resources: [{ id: 'iron', value: 50 }] }],
    },
    suggestions: ['Go on'],
  });
  assert.deepEqual(again.events, [{ type: 'faction_added', id: 'f_wei', name: 'Wei' }]);
});

test('ids cannot be words every object already answers to, and amounts stay within reason', () => {
  const world = worldWithBoard();
  const outcome = run('record', world, {
    characters: [{ id: 'constructor', name: 'Nobody' }],
    sandbox: {
      factions: [
        { id: '__proto__', status: 'Everywhere' },
        { id: 'f_aren', resources: [{ id: 'gold', value: 1e308 }] },
        { id: 'f_vesk', income: [{ id: 'troops', value: -1e300 }] },
      ],
      regions: [{ id: 'toString', name: 'Nowhere' }],
    },
    suggestions: ['Go on'],
  });

  assert.deepEqual(rejectedAt(outcome.report), [
    'characters[0]',
    'sandbox.factions[0]',
    'sandbox.factions[1]',
    'sandbox.factions[2]',
    'sandbox.regions[0]',
  ]);
  // Nothing leaked onto every object in the process.
  assert.equal(({} as { status?: string }).status, undefined);
  assert.deepEqual(Object.keys(world.modules.sandbox?.factions ?? {}), ['f_aren', 'f_vesk']);
  assert.equal(world.modules.sandbox?.factions.f_aren?.resources.gold, 100);
});

test('relations are kept in plain string order, whichever way round they are given', () => {
  const world = worldWithBoard();
  run('record', world, {
    sandbox: {
      factions: [
        { id: 'Zeta', name: 'Zeta' },
        { id: 'alpha', name: 'Alpha' },
      ],
      relations: [{ a: 'alpha', b: 'Zeta', stance: 'allied' }],
    },
    suggestions: ['Go on'],
  });
  const relation = world.modules.sandbox?.relations.find((entry) => entry.stance === 'allied');
  // Capitals sort first: "Zeta" < "alpha".
  assert.deepEqual([relation?.a, relation?.b], ['Zeta', 'alpha']);
  assert.ok((relation?.a ?? '') < (relation?.b ?? ''));
});

test('a battle goes to numbers and position, with luck deciding the close ones', () => {
  const even = faces(6, 3);
  const fight = (attackerForce: number, defenderForce: number, edges = {}, random = even) =>
    resolveBattle({ attackerForce, defenderForce, attackerEdge: 0, defenderEdge: 0, ...edges }, random);

  const rout = fight(100, 50);
  assert.deepEqual([rout.winner, rout.margin, rout.attackerLosses, rout.defenderLosses], ['attacker', 'decisive', 3, 30]);

  // Evenly matched, the defender holds.
  const stand = fight(100, 100);
  assert.deepEqual([stand.winner, stand.margin, stand.attackerLosses, stand.defenderLosses], ['defender', 'narrow', 25, 20]);

  // Walls are worth men.
  assert.deepEqual([fight(100, 100, { defenderEdge: 3 }).margin, fight(120, 100, { defenderEdge: 3 }).winner], ['clear', 'defender']);
  // And fortune can turn an even fight: a 12 against a 2.
  assert.equal(fight(100, 100, {}, faces(6, 6, 6, 1, 1)).winner, 'attacker');
});

test('simulate settles a battle on the board: losses are taken, the region changes hands', () => {
  const world = worldWithBoard();
  const outcome = run(
    'simulate',
    world,
    {
      battles: [
        {
          attacker_id: 'f_aren',
          defender_id: 'f_vesk',
          region_id: 'r_ford',
          // More than Aren has: nobody fields more than they have.
          attacker_force: 80,
          defender_force: 40,
          losses_from: 'troops',
          reason: 'Aren storms the ford',
        },
      ],
    },
    faces(6, 3),
  );

  assert.equal(outcome.isError, false);
  // The battle tells its own losses; the land is the other piece of news.
  assert.deepEqual(outcome.events, [
    {
      type: 'sandbox_battle',
      attackerId: 'f_aren',
      attackerName: 'Aren',
      defenderId: 'f_vesk',
      defenderName: 'Vesk',
      regionId: 'r_ford',
      regionName: 'Ford',
      attackerForce: 50,
      defenderForce: 40,
      attackerLosses: 8,
      defenderLosses: 10,
      winner: 'attacker',
      margin: 'narrow',
      reason: 'Aren storms the ford',
    },
    { type: 'region_taken', regionId: 'r_ford', regionName: 'Ford', fromId: 'f_vesk', fromName: 'Vesk', toId: 'f_aren', toName: 'Aren' },
  ]);
  const board = world.modules.sandbox;
  assert.deepEqual([board?.factions.f_aren?.resources.troops, board?.factions.f_vesk?.resources.troops], [42, 30]);
  assert.equal(board?.regions.r_ford?.ownerId, 'f_aren');

  const [battle] = (outcome.report as unknown as { battles: Record<string, unknown>[] }).battles;
  assert.equal(battle?.region_captured, true);
  assert.deepEqual(battle?.left, { attacker: 42, defender: 30 });
  // Whether a power with no land left has fallen is left to the game master.
  assert.equal(battle?.defender_holds_no_regions, true);
});

test('a battle for a region is fought against whoever holds it', () => {
  const world = worldWithBoard();
  run('record', world, {
    sandbox: { factions: [{ id: 'f_league', name: 'League', resources: [{ id: 'troops', value: 20 }] }], regions: [{ id: 'r_fens', owner_id: 'f_league' }] },
    suggestions: ['Go on'],
  });

  // Aren beats Vesk, but the fens are the League's, and the League was not in the fight.
  const battle = { attacker_id: 'f_aren', defender_id: 'f_vesk', attacker_force: 50, defender_force: 10, reason: 'A battle in the fens' };
  const wrongOwner = run('simulate', world, { battles: [{ ...battle, region_id: 'r_fens' }] }, faces(6, 3));
  assert.deepEqual(rejectedAt(wrongOwner.report), ['battles[0]']);
  assert.match(wrongOwner.content, /held by League/);
  assert.equal(world.modules.sandbox?.regions.r_fens?.ownerId, 'f_league');

  // Land nobody holds goes to whoever wins it.
  run('record', world, { sandbox: { regions: [{ id: 'r_fens', owner_id: null }] }, suggestions: ['Go on'] });
  const open = run('simulate', world, { battles: [{ ...battle, region_id: 'r_fens' }] }, faces(6, 3));
  assert.equal(open.isError, false);
  assert.equal(world.modules.sandbox?.regions.r_fens?.ownerId, 'f_aren');
});

test('simulate lets a round pass: income is applied, and what cannot be paid is reported', () => {
  const world = worldWithBoard();
  const outcome = run('simulate', world, { advance: { period: 'Summer, year 1' } });

  assert.equal(outcome.isError, false);
  assert.deepEqual(outcome.events, [
    {
      type: 'sandbox_round',
      round: 1,
      period: 'Summer, year 1',
      // The player's side only. Upkeep of 60 against 50 troops leaves none.
      changes: [
        { resource: 'Gold', from: 100, to: 110 },
        { resource: 'Troops', from: 50, to: 0 },
      ],
    },
  ]);
  const report = outcome.report as unknown as { round: { round: number; factions: Record<string, { could_not_pay?: string[] }> } };
  assert.equal(report.round.round, 1);
  assert.deepEqual(report.round.factions.f_aren?.could_not_pay, ['troops']);
  assert.equal(report.round.factions.f_vesk?.could_not_pay, undefined);
});

test('simulate refuses what it cannot settle and still settles the rest', () => {
  const noBoard = run('simulate', worldWithPlayer(), { advance: {} });
  assert.equal(noBoard.isError, true);
  assert.match(noBoard.content, /not been set up/);

  const world = worldWithBoard();
  assert.equal(run('simulate', world, {}).isError, true);

  const mixed = run(
    'simulate',
    world,
    {
      battles: [
        { attacker_id: 'f_aren', defender_id: 'f_ghost', attacker_force: 10, defender_force: 10, reason: 'Against nobody' },
        { attacker_id: 'f_vesk', defender_id: 'f_aren', attacker_force: 10, defender_force: 30, reason: 'A raid' },
      ],
      advance: {},
    },
    faces(6, 3),
  );
  assert.equal(mixed.isError, true);
  assert.deepEqual(rejectedAt(mixed.report), ['battles[0]']);
  assert.deepEqual(types(mixed.events), ['sandbox_battle', 'sandbox_round']);
});

// --- what a story has ---------------------------------------------------------

test('a module that is off is not offered: no tools, no section of the record, no instructions', () => {
  const names = (modules: ModuleId[]) => getToolbox({ illustrations: false, modules }).specs.map((spec) => spec.name);
  const sections = (modules: ModuleId[]) => {
    const record = getToolbox({ illustrations: false, modules }).specs.find((spec) => spec.name === 'record');
    return Object.keys((record?.inputSchema.properties ?? {}) as object);
  };

  assert.deepEqual(names(['dice']), ['narrate', 'roll_dice', 'check', 'record']);
  assert.deepEqual(names(['sandbox']), ['narrate', 'simulate', 'record']);
  // Asked for in any order, the tools come in one order, so the request caches.
  assert.deepEqual(names(['sandbox', 'dice']), ['narrate', 'roll_dice', 'check', 'simulate', 'record']);
  assert.equal(getToolbox({ illustrations: false, modules: ['sandbox', 'dice'] }), getToolbox({ illustrations: false, modules: ['dice', 'sandbox'] }));

  assert.ok(sections(['dice', 'sandbox']).includes('sandbox') && sections(['dice', 'sandbox']).includes('dice'));
  assert.ok(!sections(['dice']).includes('sandbox'));
  assert.ok(!sections([]).includes('dice'));

  // Sent anyway, the section is refused like any other unknown one.
  const diceOnly = getToolbox({ illustrations: false, modules: ['dice'] });
  const world = worldWithPlayer();
  const outcome = diceOnly.get('record')?.run(world, { sandbox: BOARD, suggestions: ['Go on'] }, { random: () => 0, narrate: () => {} });
  assert.match(outcome?.content ?? '', /Unknown section/);
  assert.equal(world.modules.sandbox, undefined);
  assert.equal(diceOnly.get('simulate'), undefined);

  for (const locale of ['en', 'zh'] as const) {
    const system = (modules: ModuleId[]) => getPrompts(locale).system({ illustrations: false, modules });
    assert.ok(!system([]).includes('roll_dice') && !system([]).includes('record.sandbox'), locale);
    assert.ok(system(['dice']).includes('roll_dice') && !system(['dice']).includes('record.sandbox'), locale);
    assert.ok(system(['dice', 'sandbox']).includes('record.sandbox'), locale);
    // With nothing to wait for, a turn is two steps and they are numbered so.
    assert.ok(system([]).includes('1. ') && system([]).includes('2. ') && !system([]).includes('3. '), locale);
    assert.ok(system(['dice']).includes('3. '), locale);
  }
});

function newSession(overrides: Partial<Session> = {}): Session {
  const now = new Date().toISOString();
  return {
    id: 'test-session',
    createdAt: now,
    updatedAt: now,
    language: 'en',
    seed: { premise: '', playerName: 'Ash', playerConcept: '' },
    modules: ['dice', 'sandbox'],
    modulesAuto: true,
    world: createEmptyWorld(),
    messages: [],
    ...overrides,
  };
}

function harness(provider: LLMProvider = new MockProvider({ delayMs: 0 }), random: () => number = () => 0.5) {
  const events: TurnEvent[] = [];
  return { events, deps: { provider, emit: (event: TurnEvent) => void events.push(structuredClone(event)), signal: new AbortController().signal, random } };
}

const eventTypes = (session: Session, turn: number) =>
  session.messages.flatMap((message) => (message.kind === 'event' && message.turn === turn ? [message.event.type] : []));

test('left to choose, the game master keeps the modules its opening set up, and dice besides', async () => {
  const atWar = newSession({ seed: { premise: 'Three kingdoms at war', playerName: '', playerConcept: '' } });
  assert.equal((await runTurn(atWar, { kind: 'start' }, harness().deps)).error, null);
  assert.deepEqual([atWar.modules, atWar.modulesAuto], [['dice', 'sandbox'], false]);
  const board = atWar.world.modules.sandbox;
  assert.deepEqual([Object.keys(board?.factions ?? {}).length, Object.keys(board?.regions ?? {}).length], [3, 9]);
  assert.equal(Object.values(board?.factions ?? {}).filter((faction) => faction.isPlayer).length, 1);

  // A story that never touched the board does not go on carrying it.
  const atTheInn = newSession();
  await runTurn(atTheInn, { kind: 'start' }, harness().deps);
  assert.deepEqual([atTheInn.modules, atTheInn.modulesAuto], [['dice'], false]);
  assert.equal(atTheInn.world.modules.sandbox, undefined);

  // The player's own choice is left as it is.
  const chosen = newSession({ modules: ['sandbox'], modulesAuto: false });
  await runTurn(chosen, { kind: 'start' }, harness().deps);
  assert.deepEqual(chosen.modules, ['sandbox']);
});

test('a turn on the board hands the battle and the round to the sandbox, then tells how it came out', async () => {
  const session = newSession({ seed: { premise: 'Three kingdoms at war', playerName: '', playerConcept: '' } });
  // 2d6 of all sixes for the attacker's dice first, then the defender's.
  const { deps } = harness(new MockProvider({ delayMs: 0 }), faces(6, 6, 6, 1, 1));
  await runTurn(session, { kind: 'start' }, deps);

  const outcome = await runTurn(session, { kind: 'action', text: 'March on Ashford and attack' }, deps);

  assert.equal(outcome.error, null);
  assert.deepEqual(eventTypes(session, 2), ['sandbox_battle', 'region_taken', 'sandbox_round', 'quest_updated', 'relation_changed']);
  const board = session.world.modules.sandbox;
  assert.equal(board?.regions.r_ashford?.ownerId, 'f_aren');
  assert.equal(board?.round, 1);
  assert.equal(board?.relations.find((relation) => relation.b === 'f_vesk')?.stance, 'war');
  assert.ok(session.messages.some((message) => message.kind === 'narration' && message.turn === 2));
});

test('a story with no modules plays without dice, in a single step', async () => {
  const session = newSession({ modules: [], modulesAuto: false });
  const { deps } = harness();
  await runTurn(session, { kind: 'start' }, deps);
  const outcome = await runTurn(session, { kind: 'action', text: 'I look around' }, deps);

  assert.equal(outcome.error, null);
  assert.ok(!eventTypes(session, 2).some((type) => type === 'dice_rolled' || type === 'check_rolled'));
  assert.equal(session.world.modules.dice, undefined);
});

test('a tool of a module the story does not have is unknown to it', async () => {
  const results: ToolResult[] = [];
  const steps: Partial<StepResult>[] = [
    { stop: 'tool_use', toolCalls: [{ id: 's1', name: 'simulate', input: { advance: {} } }] },
    {
      stop: 'tool_use',
      toolCalls: [
        { id: 'n1', name: 'narrate', input: { text: 'Nothing stirs.' } },
        { id: 'r1', name: 'record', input: { scene: { summary: 'Quiet.' }, suggestions: ['Wait'] } },
      ],
    },
  ];
  const provider: LLMProvider = {
    kind: 'mock',
    startConversation(): Conversation {
      let index = 0;
      return {
        step: async () => ({ text: '', toolCalls: [], stop: 'end', usage: { ...NO_USAGE }, ...steps[index++] }),
        submitToolResults: (submitted) => void results.push(...submitted),
        addUserMessage: () => {},
      };
    },
  };
  const session = newSession({ modules: ['dice'], modulesAuto: false });
  session.world.turn = 1;

  const outcome = await runTurn(session, { kind: 'action', text: 'Wait a season' }, harness(provider).deps);

  assert.equal(outcome.error, null);
  assert.deepEqual(results, [{ id: 's1', content: 'Unknown tool "simulate".', isError: true }]);
});

test('the game master is shown only the state of modules it has tools for; characters know how the board stands', async () => {
  const session = newSession({ seed: { premise: 'Three kingdoms at war', playerName: '', playerConcept: '' } });
  await runTurn(session, { kind: 'start' }, harness().deps);
  const { world } = session;

  const shown = (modules: ModuleId[]) => Object.keys((gameMasterView(world, '', 8, modules) as WorldState).modules);
  assert.deepEqual(shown(['dice', 'sandbox']), ['dice', 'sandbox']);
  assert.deepEqual(shown(['dice']), ['dice']);
  assert.ok(world.modules.sandbox, 'switching a module off does not erase what it kept');

  const king = world.characters.npc_vesk_king;
  const chancellor = world.characters.npc_chancellor;
  assert.ok(king && chancellor);
  const told = (character: typeof king, modules: ModuleId[] = ['dice', 'sandbox']) =>
    buildActorInit(session, character, 'What do you hold?', 2, 12, modules).prompt;

  // Anyone knows who holds what; only a faction's leader knows its books.
  assert.match(told(chancellor), /<the_board>/);
  assert.match(told(chancellor), /Kingdom of Vesk/);
  assert.ok(!told(chancellor).includes('you_lead'));
  assert.match(told(king), /"you_lead":\{"name":"Kingdom of Vesk","has":\{"Treasury":150/);

  // Played without the board, nobody is shown it; and a character is shown no module unless it is named.
  assert.ok(!told(king, ['dice']).includes('<the_board>'));
  assert.ok(!buildActorInit(session, king, 'What do you hold?', 2).prompt.includes('<the_board>'));
});

// --- storage and the API ------------------------------------------------------

test('sessions remember their modules; older saves had dice and nothing else', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'roleplay-'));
  try {
    const sessions = new SessionStore(dataDir);
    const subscribed = ['dice', 'sandbox'] as const;
    const auto = await sessions.create({ language: 'en' }, subscribed);
    assert.deepEqual([auto.modules, auto.modulesAuto], [['dice', 'sandbox'], true]);
    const chosen = await sessions.create({ language: 'en', modules: ['sandbox', 'dice', 'sandbox'] }, subscribed);
    assert.deepEqual([chosen.modules, chosen.modulesAuto], [['dice', 'sandbox'], false]);
    const bare = await sessions.create({ language: 'en', modules: [] }, subscribed);
    assert.deepEqual([bare.modules, bare.modulesAuto], [[], false]);

    // A session as written before modules existed.
    const { modules: _modules, modulesAuto: _auto, world, ...rest } = bare;
    const { modules: _states, ...oldWorld } = world;
    await mkdir(path.join(dataDir, 'sessions'), { recursive: true });
    await writeFile(path.join(dataDir, 'sessions', 'oldsave1.json'), JSON.stringify({ ...rest, id: 'oldsave1', world: oldWorld }));
    const old = await sessions.get('oldsave1');
    assert.deepEqual([old?.modules, old?.modulesAuto, old?.world.modules], [['dice'], false, {}]);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('the player can change a story\'s modules between turns', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'roleplay-'));
  try {
    const app = createApp({
      sessions: new SessionStore(dataDir),
      settings: new SettingsStore(dataDir, {}),
      images: new ImageStore(dataDir),
      createProvider: () => new MockProvider({ delayMs: 0 }),
      createPainter: () => null,
    });
    const send = (method: string, url: string, body?: unknown) =>
      app.request(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

    await send('PUT', '/api/settings', { subscribedModules: ['dice', 'sandbox'] });
    const created = (await (await send('POST', '/api/sessions', { language: 'en' })).json()) as Session;
    assert.equal(created.modulesAuto, true);

    const patched = await send('PATCH', `/api/sessions/${created.id}`, { modules: ['sandbox'] });
    assert.equal(patched.status, 200);
    const session = (await patched.json()) as Session;
    // Once the player has chosen, the choice is no longer the game master's.
    assert.deepEqual([session.modules, session.modulesAuto], [['sandbox'], false]);

    assert.equal((await send('PATCH', `/api/sessions/${created.id}`, { modules: ['cards'] })).status, 400);
    // Two changes at once: the session is claimed by the first, and the second is told to wait.
    const [first, second] = await Promise.all([
      send('PATCH', `/api/sessions/${created.id}`, { modules: ['sandbox'] }),
      send('PATCH', `/api/sessions/${created.id}`, { modules: ['dice'] }),
    ]);
    assert.deepEqual([first.status, second.status].sort(), [200, 409]);
    assert.equal((await send('PATCH', '/api/sessions/nosuchsession', { modules: [] })).status, 404);

    // The turn stream ends by saying which modules the story now has.
    const stream = await (await send('POST', `/api/sessions/${created.id}/turns`, { kind: 'start' })).text();
    const done = stream.split('\n').find((line) => line.startsWith('data: {"type":"done"'));
    assert.deepEqual((JSON.parse(done?.slice('data: '.length) ?? '{}') as { modules?: string[] }).modules, ['sandbox']);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
