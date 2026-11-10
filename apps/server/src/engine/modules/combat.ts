import {
  COMBAT_SIDES,
  type AttackOutcome,
  type Character,
  type Combatant,
  type CombatState,
  type WorldEvent,
  type WorldState,
} from '@roleplay/shared';
import { z } from 'zod';
import { rollDice } from '../dice';
import { asParts, entryReader, id, invalidInput, toJsonSchema, type EntryError, type GameTool, type ToolContext } from '../toolKit';
import { setStat, WorldOpError } from '../world';
import type { GameModule } from './types';

/**
 * Combat, for fights worth playing blow by blow: who acts in what order, who
 * hits whom, how much health everyone has left. The game master begins a
 * fight and has its blows resolved with `fight`, so that whether a sword lands
 * is not simply whatever the storyteller fancies; it keeps the fight in step
 * with the story between blows, and ends it, through `record.combat`. A cast
 * member's health is a stat on their sheet, and the tracker reads and writes
 * that stat rather than keeping a second number that could drift from it.
 */

export const FIGHT = 'fight';

// Far beyond any story's health, and small enough to stay readable on a panel.
const HP_LIMIT = 9999;
const MAX_COMBATANTS = 20;

const NO_FIGHT = 'No fight is on. A fight begins with begin in the fight tool.';

const die = (sides: number, random: () => number) => Math.floor(random() * sides) + 1;
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
const unique = (labels: string[]) => [...new Set(labels.map((label) => label.trim()).filter(Boolean))];

// --- the rules ----------------------------------------------------------------

export interface AttackInput {
  /** Added to the d20. */
  bonus: number;
  /** The target's defense: what the total must meet. */
  defense: number;
  /** Dice notation ("1d8+2") or a plain number ("3"). */
  damage: string;
  edge?: 'advantage' | 'disadvantage';
}

export interface AttackResult {
  rolls: number[];
  kept: number;
  total: number;
  outcome: AttackOutcome;
  damageRolls: number[];
  damage: number;
}

const FLAT_DAMAGE = /^\d{1,4}$/;
const compact = (notation: string) => notation.replace(/\s+/g, '');

/** Whether the damage can be rolled: dice notation, or a plain number of points. */
function readableDamage(notation: string): boolean {
  return FLAT_DAMAGE.test(compact(notation)) || rollDice(notation, () => 0) !== null;
}

/** The damage dice, rolled `times` over with the modifier added once. A plain number has no dice to roll. */
function rollDamage(notation: string, times: number, random: () => number): { rolls: number[]; total: number } {
  if (FLAT_DAMAGE.test(compact(notation))) return { rolls: [], total: Number(compact(notation)) };
  const rolls: number[] = [];
  let modifier = 0;
  for (let time = 0; time < times; time++) {
    const roll = rollDice(notation, random);
    if (!roll) throw new WorldOpError(unreadable(notation));
    rolls.push(...roll.rolls);
    modifier = roll.modifier;
  }
  return { rolls, total: sum(rolls) + modifier };
}

const unreadable = (notation: string) =>
  `Cannot read damage "${notation}". Use dice notation such as "1d6", "1d8+2" or "2d6", or a plain number such as "3".`;

/**
 * Rolls one attack and judges it. A d20 (two with an edge, keeping the better
 * or the worse) plus the bonus must meet the defense. A natural 20 hits
 * whatever the total and rolls the damage dice twice; a natural 1 misses
 * whatever the total. A hit always does at least 1. Throws WorldOpError when
 * the damage cannot be read.
 */
export function resolveAttack(input: AttackInput, random: () => number): AttackResult {
  const rolls = input.edge ? [die(20, random), die(20, random)] : [die(20, random)];
  const kept = input.edge === 'disadvantage' ? Math.min(...rolls) : Math.max(...rolls);
  const total = kept + input.bonus;
  const outcome: AttackOutcome = kept === 20 ? 'critical' : kept === 1 ? 'fumble' : total >= input.defense ? 'hit' : 'miss';
  if (outcome === 'miss' || outcome === 'fumble') return { rolls, kept, total, outcome, damageRolls: [], damage: 0 };
  const damage = rollDamage(input.damage, outcome === 'critical' ? 2 : 1, random);
  return { rolls, kept, total, outcome, damageRolls: damage.rolls, damage: Math.max(damage.total, 1) };
}

// --- health, and the sheet it lives on ----------------------------------------

/** The numeric stat of that name on the sheet, however the game master capitalised it. */
function numericStat(character: Character, name: string): { name: string; value: number; max?: number } | undefined {
  const wanted = name.trim().toLowerCase();
  const stat = character.stats.find((entry) => entry.name.trim().toLowerCase() === wanted);
  if (typeof stat?.value !== 'number') return undefined;
  return { name: stat.name, value: stat.value, max: stat.max };
}

const numericStatNames = (character: Character) =>
  character.stats.filter((entry) => typeof entry.value === 'number').map((entry) => entry.name).join(', ') || 'none';

const isLinked = (combatant: Combatant) => combatant.characterId !== null && combatant.hpStat !== null;

/**
 * Shows a new health on the combatant. At 0 they are down; lifted off 0 they
 * are back in, since 0 was what put them out. Someone who fled or yielded
 * stays out whatever their health does.
 */
function showHealth(combatant: Combatant, hp: number, maxHp: number): void {
  const wasAtZero = combatant.hp <= 0;
  combatant.hp = Math.max(hp, 0);
  combatant.maxHp = maxHp;
  if (combatant.hp <= 0) combatant.down = true;
  else if (wasAtZero) combatant.down = false;
}

/**
 * Brings a linked combatant back in line with their sheet, which is the truth:
 * the game master may have changed the stat in the record. When the link no
 * longer holds (the character left the cast, the stat is gone or is no longer
 * a number) the combatant keeps its last numbers as its own.
 */
function readSheet(world: WorldState, combatant: Combatant): void {
  if (!combatant.characterId || !combatant.hpStat) return;
  const character = world.characters[combatant.characterId];
  if (!character) {
    combatant.characterId = null;
    combatant.hpStat = null;
    return;
  }
  const stat = numericStat(character, combatant.hpStat);
  if (!stat) {
    combatant.hpStat = null;
    return;
  }
  // A stat with no upper bound started the fight full: the most it has been is its maximum.
  showHealth(combatant, stat.value, stat.max ?? Math.max(combatant.maxHp, stat.value));
}

/** Brings every linked combatant of a fight that is on in line with their sheets. */
function readSheets(world: WorldState): void {
  const fight = world.modules.combat;
  if (!fight?.active) return;
  for (const combatant of Object.values(fight.combatants)) readSheet(world, combatant);
}

/** Sets a combatant's health, on their sheet when they are linked to one. Returns the sheet's own notices. */
function writeHealth(world: WorldState, combatant: Combatant, hp: number): WorldEvent[] {
  const { characterId, hpStat } = combatant;
  const events = characterId && hpStat ? setStat(world, characterId, hpStat, hp) : [];
  showHealth(combatant, hp, combatant.maxHp);
  return events;
}

// --- who is in a fight ----------------------------------------------------------

// What a combatant is made of. The model is told what each field means once,
// in fight's begin (`newCombatant`); a newcomer in the record takes the same
// fields and is pointed there, so the descriptions are not sent twice. The
// typical numbers (defense, bonus, damage, health) are in the guide.
const health = z.number().int().min(0).max(HP_LIMIT);
const COMBATANT_FIELDS = {
  id,
  side: z.enum(COMBAT_SIDES),
  defense: z.number().int().min(1).max(40),
  initiative_bonus: z.number().int().min(-10).max(20).optional(),
  conditions: z.array(z.string().max(60)).max(8).optional(),
  character_id: id.optional(),
  hp_stat: z.string().optional(),
  name: z.string().optional(),
  hp: health.optional(),
  max_hp: z.number().int().min(1).max(HP_LIMIT).optional(),
};

const newCombatant = z.strictObject({
  ...COMBATANT_FIELDS,
  id: id.describe('For a cast member their character id; for a passing foe e.g. "bandit_1".'),
  defense: COMBATANT_FIELDS.defense.describe('What an attack roll must meet to hit them.'),
  initiative_bonus: COMBATANT_FIELDS.initiative_bonus.describe('Added to their initiative d20: 0 for most, 2 to 4 for the quick. Defaults to 0.'),
  conditions: COMBATANT_FIELDS.conditions.describe('Short labels in the story language, e.g. "poisoned".'),
  character_id: id.optional().describe('A cast member: their character id, with hp_stat.'),
  hp_stat: COMBATANT_FIELDS.hp_stat.describe('The numeric stat on their sheet that is their health, as recorded, e.g. "HP". Blows are written to it.'),
  name: COMBATANT_FIELDS.name.describe('A passing foe: what the player reads. A cast member goes by their own name unless given one.'),
  hp: COMBATANT_FIELDS.hp.describe('A passing foe with no sheet: their health.'),
  max_hp: COMBATANT_FIELDS.max_hp.describe('A passing foe already hurt: their full health. Defaults to hp.'),
});

const combatantChange = z.strictObject({
  ...COMBATANT_FIELDS,
  id: id.describe('Combatant id.'),
  side: COMBATANT_FIELDS.side.optional(),
  defense: COMBATANT_FIELDS.defense.optional(),
  character_id: id.optional().describe('Character id.'),
  conditions: COMBATANT_FIELDS.conditions.describe('Replaces their conditions.'),
  hp: health.optional().describe('Set their health, never above their maximum. For a newcomer with no sheet, their health.'),
  change: z
    .number()
    .int()
    .min(-HP_LIMIT)
    .max(HP_LIMIT)
    .optional()
    .describe('Or add this to their health: negative harms, positive heals. Not for blows dealt by fight.'),
  down: z.boolean().optional().describe('true: out of the fight with health left (fled, yielded). false: back in.'),
  remove: z.boolean().optional().describe('true takes them off the board.'),
});

type Arrival = z.infer<typeof combatantChange>;

function requireCombatant(fight: CombatState, combatantId: string): Combatant {
  const combatant = fight.combatants[combatantId];
  if (!combatant) {
    const known = fight.order.join(', ') || 'none';
    throw new WorldOpError(`There is no combatant "${combatantId}" in this fight. Combatants: ${known}.`);
  }
  return combatant;
}

/**
 * A combatant built from an entry, initiative rolled. Everything that can be
 * wrong with the entry is checked before the dice are touched; nothing is
 * written to the world here.
 */
function enlist(world: WorldState, others: Combatant[], entry: Arrival, random: () => number): Combatant {
  const { id: combatantId, side: chosenSide, defense: chosenDefense } = entry;
  if (others.some((other) => other.id === combatantId)) throw new WorldOpError(`Two combatants share the id "${combatantId}". Give each its own.`);
  const how = 'either character_id and hp_stat (someone in the cast, whose sheet holds their health) or name and hp (a passing foe with no sheet)';
  if (!chosenSide || chosenDefense === undefined || entry.change !== undefined || entry.remove) {
    const known = others.map((other) => other.id).join(', ') || 'none';
    throw new WorldOpError(`There is no combatant "${combatantId}" in this fight (combatants: ${known}). To bring in a newcomer, give side, defense and ${how}.`);
  }

  let linked: { characterId: string; hpStat: string; name: string; hp: number; maxHp: number } | undefined;
  if (entry.character_id !== undefined || entry.hp_stat !== undefined) {
    if (!entry.character_id) throw new WorldOpError(`hp_stat names a stat on someone's sheet: give character_id too, or give name and hp for a foe with no sheet.`);
    const character = world.characters[entry.character_id];
    if (!character) {
      throw new WorldOpError(`There is no character with id "${entry.character_id}". Record them under characters first, or give name and hp for a foe with no sheet.`);
    }
    const statNote = `Their numeric stats: ${numericStatNames(character)}. Name one of those, or record their health on their sheet under characters first.`;
    if (!entry.hp_stat?.trim()) throw new WorldOpError(`Give hp_stat: the stat on ${character.name}'s sheet that is their health. ${statNote}`);
    if (entry.hp !== undefined || entry.max_hp !== undefined) {
      throw new WorldOpError(`${character.name}'s health is the stat "${entry.hp_stat}" on their sheet. Leave out hp and max_hp.`);
    }
    const twin = others.find((other) => other.characterId === character.id);
    if (twin) throw new WorldOpError(`${character.name} is already in the fight as "${twin.id}".`);
    const stat = numericStat(character, entry.hp_stat);
    if (!stat) throw new WorldOpError(`${character.name} has no numeric stat "${entry.hp_stat}". ${statNote}`);
    linked = { characterId: character.id, hpStat: stat.name, name: entry.name?.trim() || character.name, hp: stat.value, maxHp: stat.max ?? stat.value };
  } else if (!entry.name?.trim() || entry.hp === undefined) {
    throw new WorldOpError(`Combatant "${combatantId}" needs ${how}.`);
  }

  const maxHp = linked?.maxHp ?? entry.max_hp ?? entry.hp ?? 0;
  const hp = Math.max(linked?.hp ?? Math.min(entry.hp ?? 0, maxHp), 0);
  return {
    id: combatantId,
    name: linked?.name ?? entry.name?.trim() ?? '',
    side: chosenSide,
    characterId: linked?.characterId ?? null,
    hpStat: linked?.hpStat ?? null,
    hp,
    maxHp,
    defense: chosenDefense,
    initiative: die(20, random) + (entry.initiative_bonus ?? 0),
    conditions: unique(entry.conditions ?? []),
    down: hp <= 0 || entry.down === true,
  };
}

/** Acting order: higher initiative first; on a tie the player, then the order given. */
function actingOrder(combatants: Combatant[]): string[] {
  const isPlayer = (combatant: Combatant) => Number(combatant.side === 'player');
  return combatants
    .map((combatant, index) => ({ combatant, index }))
    .sort((a, b) => b.combatant.initiative - a.combatant.initiative || isPlayer(b.combatant) - isPlayer(a.combatant) || a.index - b.index)
    .map(({ combatant }) => combatant.id);
}

function beginFight(world: WorldState, entry: { combatants: Arrival[] }, random: () => number): WorldEvent[] {
  // The whole line-up is built before the old fight is replaced, so a rejected begin leaves the board as it was.
  const enlisted: Combatant[] = [];
  entry.combatants.forEach((candidate, index) => {
    try {
      enlisted.push(enlist(world, enlisted, candidate, random));
    } catch (err) {
      if (!(err instanceof WorldOpError)) throw err;
      throw new WorldOpError(`combatants[${index}] ("${candidate.id}"): ${err.message}`);
    }
  });
  const order = actingOrder(enlisted);
  const fight: CombatState = {
    active: true,
    round: 1,
    order,
    combatants: Object.fromEntries(enlisted.map((combatant) => [combatant.id, combatant])),
    outcome: '',
  };
  // A fight still on is over the moment another begins: the log says so, with nothing to say of how.
  const before = world.modules.combat;
  const cutShort: WorldEvent[] = before?.active ? [{ type: 'combat_ended', rounds: before.round, outcome: '' }] : [];
  world.modules.combat = fight;
  return [
    ...cutShort,
    {
      type: 'combat_started',
      combatants: order.flatMap((combatantId) => {
        const combatant = fight.combatants[combatantId];
        return combatant ? [{ id: combatant.id, name: combatant.name, side: combatant.side, initiative: combatant.initiative }] : [];
      }),
    },
  ];
}

/** A late arrival takes its place by initiative, ahead of those it beats and behind those already there on a tie. */
function joinFight(fight: CombatState, newcomer: Combatant): void {
  const actsBefore = (other: Combatant) =>
    newcomer.initiative > other.initiative || (newcomer.initiative === other.initiative && newcomer.side === 'player' && other.side !== 'player');
  const at = fight.order.findIndex((otherId) => {
    const other = fight.combatants[otherId];
    return other !== undefined && actsBefore(other);
  });
  fight.combatants[newcomer.id] = newcomer;
  if (at < 0) fight.order.push(newcomer.id);
  else fight.order.splice(at, 0, newcomer.id);
}

// --- record.combat ------------------------------------------------------------

const COMBAT_PARTS = {
  combatants: z
    .array(combatantChange)
    .max(MAX_COMBATANTS)
    .describe('A new id brings in a newcomer, with the fields of a combatant in fight\'s begin. A known id changes that combatant: only the fields you pass change.'),
  end: z
    .strictObject({ outcome: z.string().min(1).describe('How it ended, in the story language. Shown to the player.') })
    .describe('Ends the fight.'),
};

const combatSection = z
  .strictObject({
    combatants: COMBAT_PARTS.combatants.optional(),
    end: COMBAT_PARTS.end.optional(),
  })
  .describe('The fight that is on: what changed besides the blows, and its end.');

function changeCombatant(world: WorldState, fight: CombatState, entry: Arrival, random: () => number): WorldEvent[] {
  const combatant = fight.combatants[entry.id];
  if (!combatant) {
    if (Object.keys(fight.combatants).length >= MAX_COMBATANTS) {
      throw new WorldOpError(`The fight already has ${MAX_COMBATANTS} combatants, which is as many as it can track. Remove those who are out of it first.`);
    }
    joinFight(fight, enlist(world, Object.values(fight.combatants), entry, random));
    return [];
  }
  if (entry.remove) {
    delete fight.combatants[entry.id];
    fight.order = fight.order.filter((otherId) => otherId !== entry.id);
    return [];
  }

  // Checked before anything is written, so a rejected entry leaves no trace.
  const relinks =
    (entry.character_id !== undefined && entry.character_id !== combatant.characterId) ||
    (entry.hp_stat !== undefined && entry.hp_stat.trim().toLowerCase() !== combatant.hpStat?.toLowerCase());
  if (relinks) {
    throw new WorldOpError(`"${entry.id}" is already in the fight, and who they are cannot change. To fight as someone else, remove them and bring them in under a new id.`);
  }
  if (entry.max_hp !== undefined && isLinked(combatant)) {
    throw new WorldOpError(`${combatant.name}'s full health is the max of "${combatant.hpStat}" on their sheet. Change it under characters.`);
  }
  const maxHp = entry.max_hp ?? combatant.maxHp;
  const hp = clamp(entry.hp ?? combatant.hp + (entry.change ?? 0), 0, maxHp);
  if (entry.down === false && hp <= 0) {
    throw new WorldOpError(`${combatant.name} is at 0 health. Heal them with hp or change to bring them back into the fight.`);
  }

  if (entry.name?.trim()) combatant.name = entry.name.trim();
  if (entry.side) combatant.side = entry.side;
  if (entry.defense !== undefined) combatant.defense = entry.defense;
  if (entry.conditions) combatant.conditions = unique(entry.conditions);
  combatant.maxHp = maxHp;
  // A sheet's own notice tells the player what a heal or a wound outside of fight did to it.
  const events = hp !== combatant.hp ? writeHealth(world, combatant, hp) : [];
  // After health, so that someone healed who has nonetheless fled stays out.
  if (entry.down !== undefined) combatant.down = entry.down;
  return events;
}

function endFight(world: WorldState, outcome: string): WorldEvent[] {
  const fight = world.modules.combat;
  if (!fight?.active) throw new WorldOpError(NO_FIGHT);
  fight.active = false;
  fight.outcome = outcome.trim();
  return [{ type: 'combat_ended', rounds: fight.round, outcome: fight.outcome }];
}

function applyCombat(world: WorldState, section: unknown, errors: EntryError[], ctx: Pick<ToolContext, 'random'>): WorldEvent[] {
  const parts = asParts(section, 'combat', errors);
  if (!parts) return [];
  const events: WorldEvent[] = [];
  const reader = entryReader(parts, 'combat.', errors, events);
  // Earlier sections of this record may have changed someone's health on their sheet.
  readSheets(world);

  // Newcomers and changes first; the end last.
  const fight = world.modules.combat;
  if (fight?.active) reader.each('combatants', combatantChange, (entry) => changeCombatant(world, fight, entry, ctx.random));
  else if (parts.combatants !== undefined && parts.combatants !== null) errors.push({ at: 'combat.combatants', problem: NO_FIGHT });
  reader.one('end', COMBAT_PARTS.end, (entry) => endFight(world, entry.outcome));
  // Sent anyway, a begin is told where fights begin rather than only that it is unknown.
  if ('begin' in parts) errors.push({ at: 'combat.begin', problem: 'A fight begins with begin in the fight tool, not in the record.' });
  reader.rejectUnknown([...Object.keys(COMBAT_PARTS), 'begin'], 'part of combat');
  return events;
}

/**
 * After every record: health changed on a sheet shows on the board. A fight
 * that is over keeps the numbers it ended with, but lets go of characters who
 * have left the cast.
 */
function afterRecord(world: WorldState): void {
  const fight = world.modules.combat;
  if (!fight) return;
  if (fight.active) {
    readSheets(world);
    return;
  }
  for (const combatant of Object.values(fight.combatants)) {
    if (combatant.characterId && !world.characters[combatant.characterId]) {
      combatant.characterId = null;
      combatant.hpStat = null;
    }
  }
}

// --- fight --------------------------------------------------------------------

const attackEntry = z.strictObject({
  attacker_id: id.describe('Combatant who attacks.'),
  target_id: id.describe('Combatant attacked.'),
  bonus: z.number().int().min(-10).max(30).optional().describe('The attacker\'s to-hit bonus, circumstances included. Defaults to 0.'),
  damage: z.string().min(1).max(20).describe('What a hit does: dice notation such as "1d8+2", or a plain number such as "3".'),
  edge: z.enum(['advantage', 'disadvantage']).optional().describe('Rolls two d20s and keeps the better or the worse.'),
  reason: z.string().describe('What the attack is, in the story language. Shown to the player.'),
});

const fightSchema = z.strictObject({
  begin: z
    .strictObject({ combatants: z.array(newCombatant).min(2).max(MAX_COMBATANTS).describe('Everyone in it.') })
    .optional()
    .describe('Starts a fight, replacing any earlier one. The server rolls initiative; the attacks are then its first round.'),
  attacks: z
    .array(attackEntry)
    .max(8)
    .optional()
    .describe('In the order they happen. Left out or empty only when begin starts a fight before any blow.'),
  next_round: z.boolean().optional().describe('true once everyone has acted: the round moves on after the attacks, unless a side has nobody standing.'),
});

type AttackEntry = z.infer<typeof attackEntry>;

function strike(world: WorldState, fight: CombatState, entry: AttackEntry, random: () => number): { report: unknown; events: WorldEvent[] } {
  if (entry.attacker_id === entry.target_id) throw new WorldOpError('A combatant cannot attack themselves.');
  const attacker = requireCombatant(fight, entry.attacker_id);
  const target = requireCombatant(fight, entry.target_id);
  if (!readableDamage(entry.damage)) throw new WorldOpError(unreadable(entry.damage));

  // Not mistakes: earlier blows in the same call can take either one out.
  const skipped = attacker.down ? `${attacker.name} is down and cannot attack.` : target.down ? `${target.name} is already down.` : undefined;
  if (skipped) return { report: { attacker: attacker.id, target: target.id, skipped }, events: [] };

  const bonus = entry.bonus ?? 0;
  const result = resolveAttack({ bonus, defense: target.defense, damage: entry.damage, edge: entry.edge }, random);
  const hp = Math.max(target.hp - result.damage, 0);
  // The sheet is written, but its notice is not passed on: the attack tells the wound itself.
  if (hp !== target.hp) writeHealth(world, target, hp);

  const event: WorldEvent = {
    type: 'attack_resolved',
    attackerId: attacker.id,
    attackerName: attacker.name,
    attackerSide: attacker.side,
    targetId: target.id,
    targetName: target.name,
    targetSide: target.side,
    rolls: result.rolls,
    kept: result.kept,
    bonus,
    total: result.total,
    defense: target.defense,
    outcome: result.outcome,
    damageNotation: entry.damage.trim(),
    damageRolls: result.damageRolls,
    damage: result.damage,
    targetHp: target.hp,
    targetMaxHp: target.maxHp,
    targetDown: target.down,
    reason: entry.reason,
  };
  const report = {
    attacker: attacker.id,
    target: target.id,
    rolls: result.rolls,
    kept: result.kept,
    bonus,
    total: result.total,
    defense: target.defense,
    outcome: result.outcome,
    damage: result.damage,
    damage_rolls: result.damageRolls,
    target_hp: target.hp,
    target_max_hp: target.maxHp,
    target_down: target.down,
  };
  return { report, events: [event] };
}

/** The sides that have nobody left standing. Bystanders (neutral) do not decide a fight. */
function sidesOut(fight: CombatState): string[] {
  const camps = [
    { name: 'the player\'s side', sides: ['player', 'ally'] },
    { name: 'the enemy side', sides: ['enemy'] },
  ];
  const everyone = Object.values(fight.combatants);
  return camps
    .filter(({ sides }) => {
      const members = everyone.filter((combatant) => sides.includes(combatant.side));
      return members.length > 0 && members.every((combatant) => combatant.down);
    })
    .map(({ name }) => name);
}

const fightTool: GameTool = {
  name: FIGHT,
  silent: false,
  // It does write health, but the turn still owes a record: the scene, conditions, what people remember.
  records: false,
  endsTurn: false,
  run(world, input, ctx) {
    const parsed = fightSchema.safeParse(input);
    if (!parsed.success) return invalidInput(parsed.error, input);
    const { begin, attacks = [], next_round: nextRound } = parsed.data;

    const events: WorldEvent[] = [];
    if (begin) {
      // Every fight begins here, so that blows exchanged as it breaks out are resolved in the same call.
      try {
        events.push(...beginFight(world, begin, ctx.random));
      } catch (err) {
        if (!(err instanceof WorldOpError)) throw err;
        const content = `The fight did not begin, and no attack was resolved: ${err.message} Send the whole call again with begin corrected.`;
        return { content, isError: true, events: [] };
      }
    }
    const fight = world.modules.combat;
    if (!fight?.active) {
      const content = 'No fight is on. Begin one in this call with begin: everyone in it, and the first round\'s attacks if blows are exchanged at once.';
      return { content, isError: true, events: [] };
    }
    if (!begin && attacks.length === 0) {
      return { content: 'Nothing to resolve: pass the attacks of the round. attacks may be left out only when begin starts a fight.', isError: true, events: [] };
    }
    readSheets(world);

    const rejected: EntryError[] = [];
    const reports: unknown[] = [];
    attacks.forEach((entry, index) => {
      try {
        const struck = strike(world, fight, entry, ctx.random);
        reports.push(struck.report);
        events.push(...struck.events);
      } catch (err) {
        if (!(err instanceof WorldOpError)) throw err;
        rejected.push({ at: `attacks[${index}]`, problem: err.message });
      }
    });
    // A fight that is decided has no next round: announcing one would only be taken back by combat.end.
    const out = sidesOut(fight);
    const advanced = nextRound === true && out.length === 0;
    if (advanced) {
      fight.round += 1;
      events.push({ type: 'combat_round', round: fight.round });
    }

    const content = JSON.stringify({
      attacks: reports,
      round: fight.round,
      standing: fight.order.flatMap((combatantId) => {
        const combatant = fight.combatants[combatantId];
        if (!combatant) return [];
        const { conditions } = combatant;
        return [
          {
            id: combatant.id,
            name: combatant.name,
            side: combatant.side,
            hp: combatant.hp,
            max_hp: combatant.maxHp,
            down: combatant.down,
            ...(conditions.length > 0 ? { conditions } : {}),
          },
        ];
      }),
      ...(out.length > 0
        ? {
            nobody_standing: `Nobody is left standing on ${out.join(' and ')}${nextRound ? ', so no new round began' : ''}. End the fight in record (combat.end), saying how it ended.`,
          }
        : {}),
      ...(rejected.length > 0
        ? {
            rejected,
            note: `Everything else was applied${begin ? ', the fight has begun' : ''}${advanced ? ', and the round has moved on' : ''}. Send only the corrected attacks again${begin ? ', without begin' : ''}${advanced ? ', without next_round' : ''}.`,
          }
        : {}),
    });
    return { content, isError: rejected.length > 0, events };
  },
};

// --- what the game master is told ---------------------------------------------

const en = `## Combat

You have a combat tracker, for fights worth playing blow by blow, tabletop style: who acts in what order, who hits, how much health everyone has left. A scuffle settled in one blow, or a fight the story only needs to sum up, does not need it: make it a check, or simply narrate it.

A fight begins with fight, under begin: everyone in it, with their side and defense. Link the player character and anyone else from the cast by their health stat (character_id and hp_stat): that stat on their sheet is then their health, every blow is written to it, and the sheet stays true. Give a passing foe with no sheet a name and hp. The server rolls initiative and shows the player the order. When blows are exchanged as it breaks out (the player strikes, an ambush lands), put that first round's attacks in the same call; for a standoff, weapons drawn and no blow yet, leave attacks out.

What the numbers mean:
- defense, what an attack roll must meet: about 10 unarmoured, 13 for light armour or someone quick, 16 for mail, 18 and up for plate or a monster.
- bonus, the attacker's to-hit: 0 for an untrained brawler, 3 to 5 for a trained fighter, up to 8 for a master; 2 more or less for the circumstances.
- damage, in dice: "1d6" for a knife or fists, "1d8+2" for a sword in strong hands, "2d6" for something big.
- hp: 4 to 10 for an ordinary person, 15 to 30 for a seasoned fighter, more for a monster.

Each turn of the fight:
1. Call fight once, with the player's attack and the attacks of everyone else who acts this round, in initiative order, and next_round true.
2. Narrate from the result: every hit, miss, critical and fumble as it fell. Someone at 0 is down: out of the fight, not necessarily dead; what that means is yours to tell.
3. In the record, under combat.combatants, note what changed besides the blows: conditions, someone joining, a heal, someone fleeing or yielding (down true). A linked character's health can be changed there or under characters, never both.
4. When one side is all down, flees or yields, end the fight with combat.end and how it ended.

The to-hit roll here is the tracker's own, a d20 plus bonus against defense, whatever dice rules the story uses for checks. Honour the result: a hit lands and a miss misses. Do not soften or overturn it in the telling.`;

const zh = `## 战斗

你有一个战斗追踪器，用于值得一招一式打下来的战斗，像跑团那样：谁先出手、谁命中、每个人还剩多少生命值。一招就分出胜负的冲突，或者故事里一笔带过就够的打斗，用不着它：做一次检定，或者直接叙述。

开战用 fight 的 begin：列出所有参战者，写明各自的阵营和防御。玩家角色以及其他登场人物，用他们的生命属性来关联（character_id 加 hp_stat）：人物卡上的那项属性就是他们的生命值，每次受伤都写回人物卡，人物卡始终准确。没有人物卡的路人敌手，直接给 name 和 hp。服务器会掷先攻，并把出手顺序展示给玩家。一打起来就动了手（玩家先出招、伏击得手），就在同一次调用里附上第一回合的攻击；只是拔刀对峙、还没人出手，就不填 attacks。

数值的含义：
- 防御（defense），攻击检定要达到的数：不穿甲约 10，轻甲或身手敏捷 13，锁子甲 16，板甲或怪物 18 以上。
- 命中加值（bonus）：没练过的莽汉 0，受过训练的战士 3 到 5，高手最多 8；视情势再加减 2。
- 伤害（damage）用骰子表示："1d6" 是匕首或拳脚，"1d8+2" 是膂力过人者手中的剑，"2d6" 是大家伙。
- 生命值（hp）：普通人 4 到 10，久经沙场的战士 15 到 30，怪物更多。

战斗中的每一回合：
1. 调用一次 fight，放进玩家的攻击和本回合其他出手者的攻击，按先攻顺序排列，并把 next_round 设为 true。
2. 按结果叙述：每一次命中、落空、暴击和大失败，骰子怎么落就怎么讲。生命值归零就是倒地：退出战斗，未必身死，具体如何由你来讲。
3. 攻击之外的变化记在 record 的 combat.combatants 里：状态、有人加入、得到治疗、逃跑或投降（down 设为 true）。关联了人物卡的角色，生命值在这里改或在 characters 里改都行，但不要两处都改。
4. 一方全部倒地、逃走或认输时，用 combat.end 结束战斗，写明结局。

这里的命中判定是追踪器自己的：d20 加命中加值对防御，不管故事的检定用哪套骰子规则。尊重结果：命中就是命中，落空就是落空，不要在叙述里把它软化或推翻。`;

export const combatModule: GameModule = {
  id: 'combat',
  // Any story can come to blows, and a fight that matters wants more than one roll.
  keptWhenUnused: true,
  hasPanel: true,
  tools: [
    {
      tool: fightTool,
      spec: {
        name: FIGHT,
        description:
          'Begin a fight (begin) and resolve its blows. Each attack is a d20 plus bonus against the target\'s defense: a natural 20 is a critical that doubles the damage dice, a natural 1 a fumble. Damage comes off the target\'s health, on their sheet when linked. Call it once per turn of a fight, before narrating, and tell the story from the result. Shown to the player.',
        inputSchema: toJsonSchema(fightSchema),
      },
    },
  ],
  record: { schema: combatSection, apply: applyCombat },
  afterRecord,
  guide: { en, zh },
};
