import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEmptyWorld, type WorldEvent, type WorldState } from '@roleplay/shared';
import { toJsonSchema, type EntryError } from '../toolKit';
import { setScene, upsertCharacter, upsertLocation } from '../world';
import { combatModule, resolveAttack } from './combat';

/** A random source that makes dice of `sides` sides come up with these faces, in order (the last one repeats). */
function faces(sides: number, ...values: number[]): () => number {
  let next = 0;
  return () => ((values[Math.min(next++, values.length - 1)] ?? 1) - 0.5) / sides;
}

/** Dice of mixed sizes, in the order they are rolled: [sides, face] for each (the last one repeats). */
function dice(...rolls: [number, number][]): () => number {
  let next = 0;
  return () => {
    const [sides, face] = rolls[Math.min(next++, rolls.length - 1)] ?? [20, 10];
    return (face - 0.5) / sides;
  };
}

const types = (events: WorldEvent[]) => events.map((event) => event.type);

interface FightReport {
  attacks: Record<string, unknown>[];
  round: number;
  standing: Record<string, unknown>[];
  nobody_standing?: string;
  rejected?: EntryError[];
  note?: string;
}

function fight(world: WorldState, input: unknown, random: () => number = faces(20, 10)) {
  const tool = combatModule.tools[0]?.tool;
  assert.ok(tool);
  const outcome = tool.run(world, input, { random, narrate: () => {} });
  let report: unknown = outcome.content;
  try {
    report = JSON.parse(outcome.content);
  } catch {
    // Plain-text results are compared as they are.
  }
  return { ...outcome, report: report as FightReport };
}

/** The combat section of a record, then what the record tool runs after every record. */
function record(world: WorldState, section: unknown, random: () => number = faces(20, 10)) {
  const keeper = combatModule.record;
  assert.ok(keeper);
  const errors: EntryError[] = [];
  const events = keeper.apply(world, section, errors, { random });
  combatModule.afterRecord?.(world);
  return { events, errors, at: errors.map((error) => error.at), problems: errors.map((error) => error.problem).join('\n') };
}

function worldWithCast(): WorldState {
  const world = createEmptyWorld();
  upsertLocation(world, { id: 'loc_road', name: 'Road' });
  setScene(world, { locationId: 'loc_road' });
  upsertCharacter(world, {
    id: 'pc',
    name: 'Ash',
    isPlayer: true,
    stats: [
      { name: 'HP', value: 12, max: 12 },
      { name: 'Nerve', value: 'Steady' },
    ],
  });
  // Health with no upper bound on the sheet.
  upsertCharacter(world, { id: 'npc_mara', name: 'Mara', stats: [{ name: 'Vigour', value: 9 }] });
  return world;
}

const ASH = { id: 'pc', side: 'player', defense: 13, character_id: 'pc', hp_stat: 'HP', initiative_bonus: 2 };
const BANDIT = { id: 'bandit', side: 'enemy', defense: 12, name: 'Bandit', hp: 5 };
const MARA = { id: 'mara', side: 'ally', defense: 11, character_id: 'npc_mara', hp_stat: 'Vigour' };

/** Ash (12 of 12 on the sheet, defense 13) against a bandit (5 health, defense 12), weapons drawn. Ash acts first: 12 against 10. */
function worldInFight(): WorldState {
  const world = worldWithCast();
  const begun = fight(world, { begin: { combatants: [ASH, BANDIT] } }, faces(20, 10));
  assert.equal(begun.isError, false, begun.content);
  return world;
}

// --- the rule -----------------------------------------------------------------

test('an attack: the d20 plus the bonus must meet the defense; a natural 20 or 1 overrides the sum', () => {
  const attack = (random: () => number, extra = {}) => resolveAttack({ bonus: 3, defense: 13, damage: '1d8+2', ...extra }, random);

  assert.deepEqual(attack(dice([20, 10], [8, 5])), { rolls: [10], kept: 10, total: 13, outcome: 'hit', damageRolls: [5], damage: 7 });
  // One short is a miss, and a miss rolls no damage.
  assert.deepEqual(attack(dice([20, 9], [8, 5])), { rolls: [9], kept: 9, total: 12, outcome: 'miss', damageRolls: [], damage: 0 });
  // A critical hits whatever the total, and rolls the damage dice twice with the modifier added once.
  assert.deepEqual(attack(dice([20, 20], [8, 3], [8, 6]), { bonus: -5, defense: 40 }), {
    rolls: [20],
    kept: 20,
    total: 15,
    outcome: 'critical',
    damageRolls: [3, 6],
    damage: 11,
  });
  // A fumble misses whatever the total.
  assert.deepEqual(attack(faces(20, 1), { bonus: 30, defense: 5 }), { rolls: [1], kept: 1, total: 31, outcome: 'fumble', damageRolls: [], damage: 0 });

  // An edge rolls two d20s and keeps the better or the worse.
  const better = attack(dice([20, 4], [20, 17], [8, 1]), { edge: 'advantage' });
  assert.deepEqual([better.rolls, better.kept, better.total, better.outcome, better.damage], [[4, 17], 17, 20, 'hit', 3]);
  const worse = attack(dice([20, 4], [20, 17]), { edge: 'disadvantage' });
  assert.deepEqual([worse.rolls, worse.kept, worse.outcome], [[4, 17], 4, 'miss']);

  // A hit always does at least 1.
  assert.equal(attack(dice([20, 15], [4, 1]), { damage: '1d4-3' }).damage, 1);
  assert.equal(attack(faces(20, 15), { damage: '0' }).damage, 1);
  // A plain number is fixed damage: no dice, so a critical has none to double.
  assert.equal(attack(faces(20, 20), { damage: ' 3 ' }).damage, 3);
  assert.deepEqual(attack(faces(20, 20), { damage: '3' }).damageRolls, []);
});

// --- fight: beginning a fight ---------------------------------------------------

test('a fight begins with everyone in it: initiative is rolled and sorted, the player first on a tie, then the order given', () => {
  const world = worldWithCast();
  // A standoff: weapons drawn, no blow yet, so no attacks.
  const { events, isError, report } = fight(
    world,
    {
      begin: {
        combatants: [
          { ...BANDIT, hp: 7, initiative_bonus: 2 },
          // Asked for as "hp"; kept the way the sheet spells it.
          { ...ASH, hp_stat: 'hp' },
          { id: 'bandit_2', side: 'enemy', defense: 12, name: 'Second bandit', hp: 7, max_hp: 9, conditions: [' limping ', 'limping', ''] },
          MARA,
          { id: 'wolf', side: 'enemy', defense: 13, name: 'Wolf', hp: 11, initiative_bonus: 5 },
        ],
      },
    },
    // One d20 each, in the order listed: 10+2, 10+2, 12, 7, 3+5.
    faces(20, 10, 10, 12, 7, 3),
  );

  assert.equal(isError, false);
  assert.deepEqual(events, [
    {
      type: 'combat_started',
      combatants: [
        { id: 'pc', name: 'Ash', side: 'player', initiative: 12 },
        { id: 'bandit', name: 'Bandit', side: 'enemy', initiative: 12 },
        { id: 'bandit_2', name: 'Second bandit', side: 'enemy', initiative: 12 },
        { id: 'wolf', name: 'Wolf', side: 'enemy', initiative: 8 },
        { id: 'mara', name: 'Mara', side: 'ally', initiative: 7 },
      ],
    },
  ]);
  assert.deepEqual([report.attacks, report.round, report.standing.map((entry) => entry.id)], [[], 1, ['pc', 'bandit', 'bandit_2', 'wolf', 'mara']]);

  const state = world.modules.combat;
  assert.ok(state);
  assert.deepEqual([state.active, state.round, state.outcome], [true, 1, '']);
  assert.deepEqual(state.order, ['pc', 'bandit', 'bandit_2', 'wolf', 'mara']);
  // A cast member's health is the stat on their sheet, its maximum the stat's max.
  assert.deepEqual(state.combatants.pc, {
    id: 'pc',
    name: 'Ash',
    side: 'player',
    characterId: 'pc',
    hpStat: 'HP',
    hp: 12,
    maxHp: 12,
    defense: 13,
    initiative: 12,
    conditions: [],
    down: false,
  });
  // A stat with no max starts the fight full.
  const mara = state.combatants.mara;
  assert.deepEqual([mara?.characterId, mara?.hpStat, mara?.hp, mara?.maxHp], ['npc_mara', 'Vigour', 9, 9]);
  // A passing foe keeps its own numbers.
  const second = state.combatants.bandit_2;
  assert.deepEqual([second?.characterId, second?.hpStat, second?.hp, second?.maxHp, second?.conditions], [null, null, 7, 9, ['limping']]);

  // A new begin replaces the fight that was on.
  fight(world, { begin: { combatants: [ASH, { id: 'bear', side: 'enemy', defense: 14, name: 'Bear', hp: 30 }] } }, faces(20, 10, 15));
  assert.deepEqual([world.modules.combat?.order, world.modules.combat?.round], [['bear', 'pc'], 1]);
});

test('a fight that breaks out with blows begins in the same call: the first round is not a turn late', () => {
  const world = worldWithCast();
  // Read through a function: an assertion on the field itself would narrow it for the rest of the test.
  const tracker = (of: WorldState) => of.modules.combat;
  assert.equal(tracker(world), undefined);

  // Initiative for Ash and the bandit, then Ash's d20 and a d8 of damage.
  const opened = fight(
    world,
    {
      begin: { combatants: [ASH, BANDIT] },
      attacks: [{ attacker_id: 'pc', target_id: 'bandit', bonus: 4, damage: '1d8', reason: 'Ash strikes first' }],
      next_round: true,
    },
    dice([20, 10], [20, 10], [20, 15], [8, 3]),
  );

  assert.equal(opened.isError, false);
  assert.deepEqual(types(opened.events), ['combat_started', 'attack_resolved', 'combat_round']);
  assert.deepEqual([tracker(world)?.active, tracker(world)?.round, tracker(world)?.combatants.bandit?.hp], [true, 2, 2]);

  // An attack the new fight cannot resolve is rejected on its own; the fight stands, and is not to be begun again.
  const fresh = worldWithCast();
  const partly = fight(fresh, {
    begin: { combatants: [ASH, BANDIT] },
    attacks: [{ attacker_id: 'pc', target_id: 'wolf', damage: '1d6', reason: 'At a wolf not there' }],
  });
  assert.equal(partly.isError, true);
  assert.deepEqual(types(partly.events), ['combat_started']);
  assert.equal(tracker(fresh)?.active, true);
  assert.match(partly.report.note ?? '', /the fight has begun.*without begin/);

  // Without begin there must be something to resolve; with no fight on, the tool says how to begin one.
  assert.match(fight(fresh, { attacks: [] }).content, /Nothing to resolve/);
  assert.match(fight(fresh, { next_round: true }).content, /Nothing to resolve/);
  assert.equal(tracker(fresh)?.round, 1);
  const none = fight(worldWithCast(), { attacks: [{ attacker_id: 'pc', target_id: 'bandit', damage: '1d6', reason: 'A swing' }] });
  assert.equal(none.isError, true);
  assert.match(none.content, /No fight is on\. Begin one in this call with begin/);
});

test('a begin that cannot be applied stops the whole call, and the fight before it stands', () => {
  const world = worldInFight();
  const before = structuredClone(world.modules.combat);
  // Would land on the fight already on, if the call went ahead.
  const jab = { attacker_id: 'pc', target_id: 'bandit', bonus: 4, damage: '1d4', reason: 'A jab' };
  const refused = (combatants: Record<string, unknown>[]) => {
    const outcome = fight(world, { begin: { combatants: [BANDIT, ...combatants] }, attacks: [jab], next_round: true });
    assert.equal(outcome.isError, true);
    assert.deepEqual(world.modules.combat, before);
    assert.deepEqual(outcome.events, []);
    return outcome.content;
  };

  const ghost = refused([{ id: 'ghost', side: 'enemy', defense: 10, character_id: 'npc_ghost', hp_stat: 'HP' }]);
  assert.match(ghost, /^The fight did not begin, and no attack was resolved: combatants\[1\] \("ghost"\): There is no character with id "npc_ghost"/);
  assert.match(ghost, /Send the whole call again with begin corrected\.$/);

  // A stat the sheet lacks, and one that is there but as a word: both answers name the numbers it does have.
  assert.match(refused([{ ...ASH, hp_stat: 'Health' }]), /no numeric stat "Health"\. Their numeric stats: HP\./);
  assert.match(refused([{ ...ASH, hp_stat: 'Nerve' }]), /no numeric stat "Nerve"\. Their numeric stats: HP\./);
  assert.match(refused([{ ...ASH, hp_stat: undefined }]), /Give hp_stat/);
  // Neither form complete.
  assert.match(refused([{ id: 'thug', side: 'enemy', defense: 10, name: 'Thug' }]), /either character_id and hp_stat .* or name and hp/);
  assert.match(refused([{ id: 'thug', side: 'enemy', defense: 10, hp: 4 }]), /either character_id and hp_stat/);
  assert.match(refused([{ id: 'thug', side: 'enemy', defense: 10, hp_stat: 'HP', hp: 4 }]), /give character_id too/);
  // The sheet is the truth: no second number beside it.
  assert.match(refused([{ ...ASH, hp: 20 }]), /health is the stat "HP" on their sheet\. Leave out hp and max_hp/);
  // One id, one combatant; one character, one combatant.
  assert.match(refused([{ ...BANDIT }]), /share the id "bandit"/);
  assert.match(refused([ASH, { ...ASH, id: 'pc_again' }]), /Ash is already in the fight as "pc"/);
  // Out of bounds, or a fight of one: the input is sent back as it came.
  assert.match(refused([{ ...BANDIT, id: 'giant', defense: 50 }]), /invalid_input/);
  assert.match(fight(world, { begin: { combatants: [BANDIT] } }).content, /invalid_input/);
  assert.deepEqual(world.modules.combat, before);
});

// --- fight: the blows -----------------------------------------------------------

test('fight resolves blows in order: wounds go on the sheet, the fallen go down, and their own attacks are skipped', () => {
  const world = worldInFight();
  const outcome = fight(
    world,
    {
      attacks: [
        { attacker_id: 'bandit', target_id: 'pc', bonus: 3, damage: '1d6', reason: 'The bandit lunges' },
        { attacker_id: 'pc', target_id: 'bandit', bonus: 4, damage: '1d8+2', reason: 'Ash strikes back' },
        { attacker_id: 'bandit', target_id: 'pc', bonus: 3, damage: '1d6', reason: 'The bandit swings again' },
      ],
      next_round: true,
    },
    // The bandit's d20 and d6, then Ash's d20 and d8. The third attack rolls nothing.
    dice([20, 15], [6, 4], [20, 12], [8, 5]),
  );

  assert.equal(outcome.isError, false);
  // The sheet was written, but its own notice does not repeat what the attack tells.
  assert.deepEqual(outcome.events, [
    {
      type: 'attack_resolved',
      attackerId: 'bandit',
      attackerName: 'Bandit',
      attackerSide: 'enemy',
      targetId: 'pc',
      targetName: 'Ash',
      targetSide: 'player',
      rolls: [15],
      kept: 15,
      bonus: 3,
      total: 18,
      defense: 13,
      outcome: 'hit',
      damageNotation: '1d6',
      damageRolls: [4],
      damage: 4,
      targetHp: 8,
      targetMaxHp: 12,
      targetDown: false,
      reason: 'The bandit lunges',
    },
    {
      type: 'attack_resolved',
      attackerId: 'pc',
      attackerName: 'Ash',
      attackerSide: 'player',
      targetId: 'bandit',
      targetName: 'Bandit',
      targetSide: 'enemy',
      rolls: [12],
      kept: 12,
      bonus: 4,
      total: 16,
      defense: 12,
      outcome: 'hit',
      damageNotation: '1d8+2',
      damageRolls: [5],
      damage: 7,
      // Not below nothing.
      targetHp: 0,
      targetMaxHp: 5,
      targetDown: true,
      reason: 'Ash strikes back',
    },
    // No combat_round: with nobody left on one side, there is no next round to begin.
  ]);
  assert.deepEqual(world.characters.pc?.stats[0], { name: 'HP', value: 8, max: 12 });

  const { report } = outcome;
  assert.deepEqual(report.attacks[0], {
    attacker: 'bandit',
    target: 'pc',
    rolls: [15],
    kept: 15,
    bonus: 3,
    total: 18,
    defense: 13,
    outcome: 'hit',
    damage: 4,
    damage_rolls: [4],
    target_hp: 8,
    target_max_hp: 12,
    target_down: false,
  });
  assert.deepEqual(report.attacks[2], { attacker: 'bandit', target: 'pc', skipped: 'Bandit is down and cannot attack.' });
  assert.equal(report.round, 1);
  assert.deepEqual(report.standing, [
    { id: 'pc', name: 'Ash', side: 'player', hp: 8, max_hp: 12, down: false },
    { id: 'bandit', name: 'Bandit', side: 'enemy', hp: 0, max_hp: 5, down: true },
  ]);
  assert.equal(
    report.nobody_standing,
    'Nobody is left standing on the enemy side, so no new round began. End the fight in record (combat.end), saying how it ended.',
  );

  // A blow at someone already down is skipped too: no roll, no event.
  const late = fight(world, { attacks: [{ attacker_id: 'pc', target_id: 'bandit', damage: '1d8', reason: 'Finish him' }] });
  assert.deepEqual([late.isError, late.events, late.report.attacks[0]?.skipped, late.report.round], [false, [], 'Bandit is already down.', 1]);
  assert.match(late.report.nobody_standing ?? '', /^Nobody is left standing on the enemy side\. End the fight/);
});

test('fight refuses what it cannot resolve and still resolves the rest', () => {
  const swing = { attacker_id: 'pc', target_id: 'bandit', bonus: 4, damage: '1d4', reason: 'A jab' };
  const world = worldInFight();
  const mixed = fight(
    world,
    { attacks: [{ ...swing, attacker_id: 'nobody' }, { ...swing, target_id: 'pc' }, { ...swing, damage: 'a lot' }, swing], next_round: true },
    dice([20, 12], [4, 2]),
  );

  assert.equal(mixed.isError, true);
  assert.deepEqual(
    (mixed.report.rejected ?? []).map((entry) => entry.at),
    ['attacks[0]', 'attacks[1]', 'attacks[2]'],
  );
  const problems = (mixed.report.rejected ?? []).map((entry) => entry.problem);
  assert.match(problems[0] ?? '', /no combatant "nobody" in this fight\. Combatants: pc, bandit\./);
  assert.match(problems[1] ?? '', /cannot attack themselves/);
  assert.match(problems[2] ?? '', /Cannot read damage "a lot"\. Use dice notation such as "1d6"/);
  // The good one went in, and so did the new round; sent again, the round must not move twice.
  assert.deepEqual(types(mixed.events), ['attack_resolved', 'combat_round']);
  assert.equal(world.modules.combat?.combatants.bandit?.hp, 3);
  assert.equal(world.modules.combat?.round, 2);
  assert.match(mixed.report.note ?? '', /without next_round/);

  // Input the schema does not allow is sent back as it came.
  assert.match(fight(world, { attacks: [{ ...swing, bonus: 99 }] }).content, /invalid_input/);
  assert.equal(world.modules.combat?.combatants.bandit?.hp, 3);
});

// --- record.combat: keeping the fight in step ----------------------------------

test('the record keeps the fight in step: newcomers by initiative, wounds and heals on the sheet, conditions, fleeing, removal', () => {
  const world = worldInFight();
  const joined = record(
    world,
    {
      combatants: [
        // 8+2 ties the bandit's 10: behind those already there.
        { id: 'wolf', side: 'enemy', defense: 13, name: 'Wolf', hp: 11, initiative_bonus: 2 },
        // 11: between Ash and the bandit.
        { id: 'scout', side: 'enemy', defense: 12, name: 'Scout', hp: 4 },
        MARA,
        { id: 'pc', change: -5 },
      ],
    },
    faces(20, 8, 11, 1),
  );
  assert.deepEqual(joined.errors, []);
  assert.deepEqual(world.modules.combat?.order, ['pc', 'scout', 'bandit', 'wolf', 'mara']);
  // A wound written to a sheet outside of fight is told by the sheet's own notice.
  assert.deepEqual(joined.events, [
    { type: 'stat_changed', characterId: 'pc', characterName: 'Ash', isPlayer: true, stat: 'HP', from: 12, to: 7, max: 12 },
  ]);

  const changed = record(world, {
    combatants: [
      // Healing stops at the maximum.
      { id: 'pc', change: 10 },
      { id: 'bandit', conditions: ['prone', ' prone '], defense: 10 },
      { id: 'wolf', down: true },
      { id: 'scout', remove: true },
      // A typo is not a newcomer.
      { id: 'bandti', change: -2 },
    ],
  });
  assert.deepEqual(changed.at, ['combat.combatants[4]']);
  assert.match(changed.problems, /no combatant "bandti" in this fight .*To bring in a newcomer, give side, defense/);
  assert.deepEqual(types(changed.events), ['stat_changed']);
  assert.equal(world.characters.pc?.stats[0]?.value, 12);
  const board = world.modules.combat;
  assert.ok(board);
  assert.deepEqual([board.combatants.bandit?.conditions, board.combatants.bandit?.defense], [['prone'], 10]);
  // Fled with health to spare: out of the fight, and still counted.
  assert.deepEqual([board.combatants.wolf?.down, board.combatants.wolf?.hp], [true, 11]);
  assert.deepEqual([board.combatants.scout, board.order], [undefined, ['pc', 'bandit', 'wolf', 'mara']]);

  // Back in; knocked to nothing; not back in at nothing; healed off nothing, back in.
  assert.deepEqual(record(world, { combatants: [{ id: 'wolf', down: false }, { id: 'bandit', hp: 0 }] }).errors, []);
  assert.deepEqual([board.combatants.wolf?.down, board.combatants.bandit?.down], [false, true]);
  const notYet = record(world, { combatants: [{ id: 'bandit', down: false }] });
  assert.match(notYet.problems, /Bandit is at 0 health\. Heal them/);
  assert.equal(board.combatants.bandit?.down, true);
  record(world, { combatants: [{ id: 'bandit', change: 2 }] });
  assert.deepEqual([board.combatants.bandit?.hp, board.combatants.bandit?.down], [2, false]);

  // A sheet's maximum is the sheet's to change.
  assert.match(record(world, { combatants: [{ id: 'pc', max_hp: 30 }] }).problems, /max of "HP" on their sheet/);
  // A fight is not begun in the record, and the record says where it is.
  const misplaced = record(world, { begin: { combatants: [ASH, BANDIT] } });
  assert.deepEqual(misplaced.at, ['combat.begin']);
  assert.match(misplaced.problems, /begins with begin in the fight tool/);
  assert.deepEqual(record(world, { truce: true }).at, ['combat.truce']);

  const ended = record(world, { end: { outcome: 'The bandits fled into the woods.' } });
  assert.deepEqual(ended.events, [{ type: 'combat_ended', rounds: 1, outcome: 'The bandits fled into the woods.' }]);
  assert.deepEqual([board.active, board.outcome], [false, 'The bandits fled into the woods.']);
  // The board stays to show how it ended; nothing more is done to it until the next begin.
  assert.equal(Object.keys(board.combatants).length, 4);
  const afterwards = record(world, { combatants: [{ id: 'pc', change: -1 }], end: { outcome: 'Again' } });
  assert.deepEqual(afterwards.at, ['combat.combatants', 'combat.end']);
  assert.match(afterwards.problems, /No fight is on\. A fight begins with begin in the fight tool\./);
});

test('after every record the board follows the sheets; a character who leaves the cast keeps their last numbers', () => {
  const world = worldWithCast();
  fight(world, { begin: { combatants: [ASH, MARA, BANDIT] } });
  const board = world.modules.combat;
  assert.ok(board);
  const health = (combatantId: string) => {
    const combatant = board.combatants[combatantId];
    return [combatant?.hp, combatant?.maxHp, combatant?.down];
  };

  // The game master changed the stat under characters, as record does before any module's section.
  upsertCharacter(world, { id: 'pc', stats: [{ name: 'HP', value: 3 }] });
  combatModule.afterRecord?.(world);
  assert.deepEqual(health('pc'), [3, 12, false]);
  upsertCharacter(world, { id: 'pc', stats: [{ name: 'HP', value: 0 }] });
  combatModule.afterRecord?.(world);
  assert.deepEqual(health('pc'), [0, 12, true]);
  upsertCharacter(world, { id: 'pc', stats: [{ name: 'HP', value: 6 }] });
  combatModule.afterRecord?.(world);
  assert.deepEqual(health('pc'), [6, 12, false]);

  // Within one record, a change in the combat section starts from what the sheet says now.
  upsertCharacter(world, { id: 'pc', stats: [{ name: 'HP', value: 5 }] });
  record(world, { combatants: [{ id: 'pc', change: -2 }] });
  assert.deepEqual([health('pc'), world.characters.pc?.stats[0]?.value], [[3, 12, false], 3]);

  // With no max on the sheet, the most it has been stands as her full health.
  upsertCharacter(world, { id: 'npc_mara', stats: [{ name: 'Vigour', value: 5 }] });
  combatModule.afterRecord?.(world);
  assert.deepEqual(health('mara'), [5, 9, false]);

  // Gone from the cast: still on the board with what she had, and blows no longer look for her sheet.
  delete world.characters.npc_mara;
  combatModule.afterRecord?.(world);
  assert.deepEqual([board.combatants.mara?.characterId, board.combatants.mara?.hpStat, ...health('mara')], [null, null, 5, 9, false]);
  const hit = fight(world, { attacks: [{ attacker_id: 'bandit', target_id: 'mara', bonus: 10, damage: '2', reason: 'A cut' }] }, faces(20, 10));
  assert.equal(hit.isError, false);
  assert.deepEqual(health('mara'), [3, 9, false]);

  // Once it is over, the board keeps the numbers it ended with.
  record(world, { end: { outcome: 'Driven off' } });
  upsertCharacter(world, { id: 'pc', stats: [{ name: 'HP', value: 12 }] });
  combatModule.afterRecord?.(world);
  assert.deepEqual(health('pc'), [3, 12, false]);
});

// --- what the game master is told ---------------------------------------------

test('the module offers fight and its record section, with a guide in both languages', () => {
  assert.deepEqual([combatModule.id, combatModule.keptWhenUnused, combatModule.hasPanel], ['combat', true, true]);
  const [offered] = combatModule.tools;
  assert.ok(offered);
  assert.deepEqual([offered.spec.name, offered.tool.name], ['fight', 'fight']);
  // The turn still owes a record after a fight.
  assert.deepEqual([offered.tool.silent, offered.tool.records, offered.tool.endsTurn], [false, false, false]);
  assert.deepEqual(Object.keys((offered.spec.inputSchema.properties ?? {}) as object), ['begin', 'attacks', 'next_round']);
  assert.ok(combatModule.record);
  // A fight begins in one place only.
  assert.deepEqual(Object.keys((toJsonSchema(combatModule.record.schema).properties ?? {}) as object), ['combatants', 'end']);

  for (const locale of ['en', 'zh'] as const) {
    const guide = combatModule.guide[locale];
    assert.match(guide, /^## \S/, locale);
    assert.equal(guide.match(/^## /gm)?.length, 1, locale);
    for (const word of ['fight', 'begin', 'attacks', 'combat.combatants', 'combat.end', 'character_id', 'hp_stat', 'next_round', '"1d8+2"']) {
      assert.ok(guide.includes(word), `${locale}: ${word}`);
    }
    assert.ok(!guide.includes('combat.begin'), `${locale}: no begin in the record`);
  }
  for (const word of ['先攻', '命中', '防御', '伤害', '回合', '倒地']) assert.ok(combatModule.guide.zh.includes(word), word);
});
