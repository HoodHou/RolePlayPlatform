import {
  HEAT_RANGE,
  REPUTATION_HISTORY,
  REPUTATION_RANGE,
  reputationTier,
  type ReputationStanding,
  type ReputationState,
  type WorldEvent,
  type WorldState,
} from '@roleplay/shared';
import { z } from 'zod';
import { eachEntry, id, type EntryError } from '../toolKit';
import { WorldOpError } from '../world';
import type { GameModule } from './types';

/**
 * Reputation & Titles: how the wider world — guilds, courts, sects, towns,
 * and the law — regards the player, from `hunted` (-100) to `revered` (+100),
 * alongside public titles and wanted heat (0 to 10). Shown to characters in
 * `talk` turns so strangers and officials react to the player's renown or infamy.
 */

function ensureReputation(world: WorldState): ReputationState {
  return (world.modules.reputation ??= {
    standings: {},
  });
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(Math.round(value), low), high);

const standingEntry = z.strictObject({
  id: id.describe('Id of the group, faction, sect, or town.'),
  name: z.string().optional().describe('Display name of the group or place. Required when creating.'),
  description: z.string().optional().describe('Who they are and what they value.'),
  change: z.number().int().min(-50).max(50).optional().describe('How far standing moved this turn: positive for renown, negative for infamy.'),
  set: z
    .number()
    .int()
    .min(REPUTATION_RANGE.min)
    .max(REPUTATION_RANGE.max)
    .optional()
    .describe('Or set standing outright (-100 to 100).'),
  title: z.string().optional().describe('Public title, rank, or epithet held with this group (e.g. "Sworn Friend", "钦犯"). Pass "" to clear.'),
  heat: z
    .number()
    .int()
    .min(HEAT_RANGE.min)
    .max(HEAT_RANGE.max)
    .optional()
    .describe('Wanted or heat level with this group, from 0 (unwanted) to 10 (hunted on sight).'),
  reason: z.string().optional().describe('What shifted the player\'s standing, in the story language. Shown to the player.'),
  remove: z.boolean().optional().describe('True to remove this group from the reputation ledger.'),
});

const reputationSection = z
  .array(standingEntry)
  .max(12)
  .describe('Standings, public titles, and wanted heat with factions, guilds, courts, or towns.');

function upsertStanding(world: WorldState, entry: z.infer<typeof standingEntry>): WorldEvent[] {
  const state = ensureReputation(world);
  const existing = state.standings[entry.id];

  if (entry.remove) {
    if (!existing) throw new WorldOpError(`There is no reputation entry with id "${entry.id}".`);
    delete state.standings[entry.id];
    return [];
  }

  const fallbackName =
    world.modules.sandbox?.factions[entry.id]?.name ?? world.locations[entry.id]?.name;
  const name = entry.name?.trim() || fallbackName;
  if (!existing && !name) {
    throw new WorldOpError(`Reputation group "${entry.id}" does not exist yet. Include "name" to add it.`);
  }

  const standing: ReputationStanding = existing ?? {
    id: entry.id,
    name: name ?? '',
    description: '',
    score: 0,
    title: '',
    heat: 0,
    history: [],
  };

  const before = {
    score: standing.score,
    title: standing.title,
    heat: standing.heat,
  };

  if (existing && entry.name?.trim()) standing.name = entry.name.trim();
  if (entry.description !== undefined) standing.description = entry.description;

  const wantedScore = entry.set ?? standing.score + (entry.change ?? 0);
  standing.score = clamp(wantedScore, REPUTATION_RANGE.min, REPUTATION_RANGE.max);

  if (entry.title !== undefined) standing.title = entry.title.trim();
  if (entry.heat !== undefined) standing.heat = clamp(entry.heat, HEAT_RANGE.min, HEAT_RANGE.max);

  const delta = standing.score - before.score;
  const reason = entry.reason?.trim() ?? '';
  if (delta !== 0 || (reason && (!existing || standing.title !== before.title || standing.heat !== before.heat))) {
    standing.history = [
      ...standing.history,
      { turn: world.turn, change: delta, reason: reason || standing.title || `${standing.score}` },
    ].slice(-REPUTATION_HISTORY);
  }

  state.standings[standing.id] = standing;

  const changed =
    !existing ||
    standing.score !== before.score ||
    standing.title !== before.title ||
    standing.heat !== before.heat;
  if (!changed) return [];
  if (!existing && standing.score === 0 && !standing.title && standing.heat === 0) return [];

  return [
    {
      type: 'reputation_changed',
      id: standing.id,
      name: standing.name,
      from: before.score,
      to: standing.score,
      title: standing.title,
      heat: standing.heat,
      reason,
    },
  ];
}

function applyReputation(world: WorldState, section: unknown, errors: EntryError[]): WorldEvent[] {
  return eachEntry(section, 'reputation', standingEntry, errors, (entry) => upsertStanding(world, entry));
}

function shownReputation(world: WorldState): unknown {
  const state = world.modules.reputation;
  if (!state) return undefined;
  const notable = Object.values(state.standings).filter(
    (item) => item.score !== 0 || item.title.length > 0 || item.heat > 0,
  );
  if (notable.length === 0) return undefined;

  return notable.map((item) => ({
    group: item.name,
    standing: reputationTier(item.score),
    score: item.score,
    ...(item.title ? { title: item.title } : {}),
    ...(item.heat > 0 ? { wanted_heat: item.heat } : {}),
  }));
}

const en = `## Reputation and titles

You have a reputation ledger under record.reputation for stories where public renown, guild rank, court favour, or wanted heat matter.

Each entry tracks a faction, guild, sect, or town on a scale from ${REPUTATION_RANGE.min} to ${REPUTATION_RANGE.max} (hunted, reviled, distrusted, neutral, respected, revered), along with any public title the player holds among them and a wanted heat level from ${HEAT_RANGE.min} to ${HEAT_RANGE.max}.

Whenever a deed becomes known, adjust the relevant group's standing with change (or set at the start of the story), bestow or strip a title, or raise and lower heat when the law or a rival sect is on their trail. Characters who speak for themselves in talk turns are shown the player's public reputation and titles, so let guards, merchants, and nobles react accordingly.`;

const zh = `## 声望与头衔

你在 record.reputation 下有一本声望名录，用于江湖名望、行会品阶、朝堂恩宠或官府通缉至关重要的故事。

每条记录对应一方势力、行会、门派或城池，声望分值从 ${REPUTATION_RANGE.min} 到 ${REPUTATION_RANGE.max}（追杀、唾弃、猜忌、平淡、敬重、尊崇），并可附带玩家在该势力中的公开头衔（title）以及 ${HEAT_RANGE.min} 到 ${HEAT_RANGE.max} 的通缉热度（heat）。

每当玩家的事迹传开，用 change（或开局时用 set）调整对应势力的声望，授予或革除头衔，或在官府与仇家追查时增减 heat。亲自开口交谈的人物会看到玩家的公开声望与头衔，让守卫、掌柜与权贵据此做出反应。`;

export const reputationModule: GameModule = {
  id: 'reputation',
  keptWhenUnused: true,
  hasPanel: true,
  tools: [],
  record: { schema: reputationSection, apply: applyReputation },
  guide: { en, zh },
  shownToCharacter: { tag: 'player_reputation', of: (world) => shownReputation(world) },
};
