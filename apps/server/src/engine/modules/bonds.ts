import {
  BOND_HISTORY,
  BOND_RANGE,
  bondStage,
  type Bond,
  type Character,
  type WorldEvent,
  type WorldState,
} from '@roleplay/shared';
import { z } from 'zod';
import { eachEntry, id, type EntryError } from '../toolKit';
import { WorldOpError } from '../world';
import type { GameModule } from './types';

/**
 * Bonds: how close each character has grown to the player, as a number that
 * moves a little with every kindness and every slight and passes through
 * stages on the way. For stories about people: a companion, a courtship, a
 * crew, a court.
 *
 * It is the one module with a part for characters who speak for themselves:
 * most of what moves a bond happens in conversation, and a conversation never
 * reaches the game master's record.
 */

/** How far a character's own account can move their bond in one exchange. */
const OWN_LIMIT = 15;

const reason = z.string().min(1).describe('What moved it, in a few words of the story language. Shown to the player.');

/** Moves a bond by `change`, or to `set`, within the range, and remembers why. */
function moveBond(
  world: WorldState,
  character: Character,
  move: { change?: number; set?: number; reason: string },
): WorldEvent[] {
  if (character.isPlayer) throw new WorldOpError('A bond is between the player and someone else.');
  const state = (world.modules.bonds ??= { bonds: {} });
  const bond: Bond = (state.bonds[character.id] ??= { characterId: character.id, score: 0, history: [] });

  const from = bond.score;
  const wanted = move.set ?? from + (move.change ?? 0);
  const to = Math.min(Math.max(Math.round(wanted), BOND_RANGE.min), BOND_RANGE.max);
  if (to === from) return [];

  bond.score = to;
  bond.history = [...bond.history, { turn: world.turn, change: to - from, reason: move.reason.trim() }].slice(-BOND_HISTORY);
  return [{ type: 'bond_changed', characterId: character.id, characterName: character.name, from, to, reason: move.reason.trim() }];
}

// --- record.bonds: the game master's account ----------------------------------

const bondEntry = z.strictObject({
  character_id: id.describe('Whose bond with the player this is.'),
  change: z.number().int().min(-40).max(40).optional().describe('How far it moved: positive toward the player, negative away.'),
  set: z.number().int().min(BOND_RANGE.min).max(BOND_RANGE.max).optional().describe('Or where it stands outright, for a character who starts the story as an old friend or an old enemy.'),
  reason,
});

const bondsSection = z
  .array(bondEntry)
  .max(12)
  .describe('Bonds that moved this turn: one entry for each character whose feeling toward the player changed because of what happened.');

function applyBonds(world: WorldState, section: unknown, errors: EntryError[]): WorldEvent[] {
  return eachEntry(section, 'bonds', bondEntry, errors, ({ character_id, ...move }) => {
    const character = world.characters[character_id];
    if (!character) throw new WorldOpError(`There is no character with id "${character_id}".`);
    return moveBond(world, character, move);
  });
}

// --- respond.bond: the character's own account --------------------------------

const ownAccount = z
  .strictObject({
    change: z.number().int().min(-OWN_LIMIT).max(OWN_LIMIT).describe('Positive if you feel closer to them now, negative if further.'),
    reason,
  })
  .describe('Fill in when this exchange moved you toward them or away from them: 1 to 3 for a small warmth or a small slight, 5 to 10 for something you will remember, up to 15 only for what changes everything. Leave out for talk that left you where you were.');

// How the account is read back: leniently. Whatever is wrong with this one
// field, the character's line itself has been spoken and must stand, so a
// change out of range is brought into it and a missing reason is left blank.
const ownAccountRead = z.object({ change: z.number(), reason: z.string().optional() });

function applyOwnAccount(world: WorldState, character: Character, reply: Record<string, unknown>): WorldEvent[] {
  const parsed = ownAccountRead.safeParse(reply.bond);
  if (!parsed.success || !Number.isFinite(parsed.data.change)) return [];
  const change = Math.min(Math.max(Math.round(parsed.data.change), -OWN_LIMIT), OWN_LIMIT);
  return moveBond(world, character, { change, reason: parsed.data.reason ?? '' });
}

/**
 * What a character knows of their own bond with the player: where it stands.
 * Not what moved it: those reasons are written for the player, some of them by
 * the game master about things this character never saw, and a character
 * knows of events only through their memories.
 */
function ownBond(world: WorldState, characterId: string): unknown {
  const score = world.modules.bonds?.bonds[characterId]?.score ?? 0;
  return { closeness: bondStage(score), score };
}

const en = `## Bonds

You have bonds: for each character, a number from ${BOND_RANGE.min} to ${BOND_RANGE.max} for how close they have grown to the player, shown to the player as a stage: hostile, cold, neutral, warm, close, devoted. It is for stories about people: a companion, a courtship, a crew, a court where favour is everything.

Whenever something the player does moves a character toward them or away, record it under bonds with the reason: 1 to 3 for a small kindness or a small slight, 5 to 10 for something they will remember, 20 or more only for what changes everything between them. Give a character who starts as an old friend or an old enemy their standing outright with set. Bonds move both ways, and slowly: trust is earned over many turns and lost in one.

Let the bond show. A warm character volunteers what a cold one withholds; a devoted one takes risks for the player, and a hostile one works against them. Characters who speak for themselves move their own bond as they talk, so you only record what happens in your own turns.`;

const zh = `## 羁绊

你有羁绊：每个人物有一个从 ${BOND_RANGE.min} 到 ${BOND_RANGE.max} 的数值，表示他与玩家走得有多近，玩家看到的是对应的阶段：敌视、冷淡、平常、亲近、亲密、倾心。它用于讲述人与人的故事：一位同伴、一段恋情、一支队伍、一座恩宠决定一切的朝堂。

每当玩家的所作所为让某个人物靠近或疏远了自己，就在 bonds 里记下来并写明缘由：小小的善意或怠慢记 1 到 3，会被记在心里的事记 5 到 10，只有彻底改变两人关系的事才记 20 以上。故事开始时就是故交或宿敌的人物，用 set 直接给出他的位置。羁绊有来有往，而且走得慢：信任要许多回合才攒得起来，一回合就能失去。

让羁绊表现出来。亲近的人物会主动说出冷淡的人物不肯说的话；倾心的会为玩家冒险，敌视的会暗中作对。亲自开口的人物会在交谈中自己调整羁绊，所以你只需要记录你自己的回合里发生的事。`;

export const bondsModule: GameModule = {
  id: 'bonds',
  // A list in the record: cheap to carry, and any story can turn on who has come to trust whom.
  keptWhenUnused: true,
  hasPanel: true,
  tools: [],
  record: { schema: bondsSection, apply: applyBonds },
  guide: { en, zh },
  shownToCharacter: { tag: 'your_bond', of: ownBond },
  actor: { fields: { bond: ownAccount.optional() }, apply: applyOwnAccount },
};
