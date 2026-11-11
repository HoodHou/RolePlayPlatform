import { MODULE_IDS, type Character, type Memory, type ModuleId, type WorldState } from '@roleplay/shared';

/**
 * Remembering. A character can hold hundreds of memories; a prompt can carry
 * a handful. `recall` picks the ones that would come to mind right now, the
 * way a person's do: what was just brought up, what happened lately, what
 * mattered, and what has to do with who and what is in front of them.
 */

export interface RecallFocus {
  /** Ids named in what was just said. Being asked about something brings it back, however old or slight. */
  cues: ReadonlySet<string>;
  /** Ids of what is simply there: who is present and where. */
  around: ReadonlySet<string>;
  /** The current turn, to judge how long ago things were. */
  turn: number;
  /** Optional raw player text, used to recall memories whose own words match the topic. */
  query?: string;
}

// Importance runs 1–5. A fresh memory adds up to 3 and fades by a tenth per
// turn. A memory about someone or something present adds 2.
const RECENCY_WEIGHT = 3;
const RECENCY_DECAY = 0.9;
const PRESENCE_BONUS = 2;
const TEXT_MATCH_BONUS = 1.5;
const MAX_TEXT_MATCH_BONUS = 3;

const EN_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'over', 'under', 'near', 'what', 'where', 'when',
  'which', 'whose', 'whom', 'this', 'that', 'these', 'those', 'about', 'have', 'been', 'were',
  'they', 'them', 'their', 'there', 'here', 'your', 'just', 'some', 'more', 'tell', 'know',
  'asked', 'asking', 'said', 'says', 'look', 'looking', 'talk', 'talking', 'old', 'new', 'high',
  'low', 'east', 'west', 'north', 'south', 'road', 'street', 'lane', 'gate', 'hall', 'room',
  'town', 'city', 'lord', 'lady', 'king', 'queen', 'captain', 'master', 'guard',
]);

const ZH_STOP_BIGRAMS = new Set([
  '我们', '你们', '他们', '她们', '什么', '怎么', '哪里', '这里', '那里', '这个', '那个',
  '可以', '不是', '没有', '一个', '知道', '告诉', '请问', '一下', '关于', '事情', '东西',
  '为什么', '怎么回', '回事', '打听', '询问', '看看', '到底', '现在', '之前', '以后', '自己',
]);

interface QueryTerms {
  words: string[];
  cjkBigrams: string[];
}

function cjkBigramsOf(text: string): string[] {
  const out = new Set<string>();
  const runs = text.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  for (const run of runs) {
    for (let i = 0; i <= run.length - 2; i++) {
      const bi = run.slice(i, i + 2);
      if (!ZH_STOP_BIGRAMS.has(bi)) out.add(bi);
    }
  }
  return [...out];
}

function extractQueryTerms(query: string | undefined): QueryTerms {
  if (!query) return { words: [], cjkBigrams: [] };
  const lower = query.toLowerCase();
  const words = [...new Set((lower.match(/[a-z0-9]{4,}/g) ?? []).filter((w) => !EN_STOPWORDS.has(w)))];
  return { words, cjkBigrams: cjkBigramsOf(lower) };
}

function countTextMatches(memoryText: string, terms: QueryTerms): number {
  if (terms.words.length === 0 && terms.cjkBigrams.length === 0) return 0;
  const lower = memoryText.toLowerCase();
  let matches = 0;
  if (terms.words.length > 0) {
    const memWords = new Set(lower.match(/[a-z0-9]+/g) ?? []);
    for (const word of terms.words) {
      if (memWords.has(word)) matches++;
    }
  }
  for (const bi of terms.cjkBigrams) {
    if (lower.includes(bi)) matches++;
  }
  return matches;
}

function concerns(memory: Memory, ids: ReadonlySet<string>): boolean {
  return memory.about.some((id) => ids.has(id)) || (memory.toldBy !== undefined && ids.has(memory.toldBy));
}

function weight(memory: Memory, focus: RecallFocus, textMatches: number): number {
  const age = Math.max(focus.turn - memory.turn, 0);
  const recency = RECENCY_WEIGHT * RECENCY_DECAY ** age;
  const textBonus = Math.min(MAX_TEXT_MATCH_BONUS, textMatches * TEXT_MATCH_BONUS);
  return memory.importance + recency + (concerns(memory, focus.around) ? PRESENCE_BONUS : 0) + textBonus;
}

/**
 * The `limit` memories most likely to come to mind, in the order they happened.
 * Up to half the places go to memories of what was just brought up (by entity
 * cue or direct keyword/CJK match), so that asking about the cellar recalls the
 * cellar even past a crowd of fresher, weightier memories; the rest go to
 * whatever weighs most.
 */
export function recall(memories: Memory[], focus: RecallFocus, limit: number): Memory[] {
  if (memories.length <= limit) return memories;

  const terms = extractQueryTerms(focus.query);
  const ranked = memories
    .map((memory, index) => {
      const textMatches = countTextMatches(memory.text, terms);
      const idCued = concerns(memory, focus.cues);
      return {
        memory,
        index,
        idCued,
        textMatches,
        weight: weight(memory, focus, textMatches),
      };
    })
    .sort((a, b) => b.weight - a.weight || b.index - a.index);

  const cued = [
    ...ranked.filter((entry) => entry.idCued),
    ...ranked.filter((entry) => !entry.idCued && entry.textMatches > 0),
  ].slice(0, Math.ceil(limit / 2));
  const chosen = new Set(cued.map((entry) => entry.index));
  for (const entry of ranked) {
    if (chosen.size >= limit) break;
    chosen.add(entry.index);
  }
  return memories.filter((_, index) => chosen.has(index));
}

function nameMatchesText(label: string, haystack: string, haystackWords: ReadonlySet<string>): boolean {
  const normalized = label.trim().toLowerCase();
  if (!normalized) return false;
  if (haystack.includes(normalized)) return true;

  // Partial word match for multi-word Latin names ("Mara Venn" -> "mara").
  const words = (normalized.match(/[a-z0-9]{4,}/g) ?? []).filter((w) => !EN_STOPWORDS.has(w));
  if (words.some((w) => haystackWords.has(w))) return true;

  // Partial CJK bigram match for 3+ character Chinese names ("沉灯客栈" -> "沉灯", "客栈").
  const cjkRuns = normalized.match(/[\u4e00-\u9fff]{3,}/g) ?? [];
  for (const run of cjkRuns) {
    for (let i = 0; i <= run.length - 2; i++) {
      const bi = run.slice(i, i + 2);
      if (!ZH_STOP_BIGRAMS.has(bi) && haystack.includes(bi)) return true;
    }
  }
  return false;
}

/** Ids of the characters, places, items, quests and lore whose names appear in a piece of text. */
export function mentionedIds(world: WorldState, text: string): string[] {
  if (!text) return [];
  const haystack = text.toLowerCase();
  const haystackWords = new Set(haystack.match(/[a-z0-9]+/g) ?? []);
  const named: { id: string; label: string }[] = [
    ...Object.values(world.characters).map((c) => ({ id: c.id, label: c.name })),
    ...Object.values(world.locations).map((l) => ({ id: l.id, label: l.name })),
    ...Object.values(world.items).map((i) => ({ id: i.id, label: i.name })),
    ...Object.values(world.quests).map((q) => ({ id: q.id, label: q.title })),
    ...Object.values(world.lore).map((entry) => ({ id: entry.id, label: entry.title })),
  ];
  return named.filter((thing) => nameMatchesText(thing.label, haystack, haystackWords)).map((thing) => thing.id);
}

/** Everyone at the scene's location, the player included. */
export function presentCharacters(world: WorldState): Character[] {
  return Object.values(world.characters).filter(
    (character) => character.locationId === world.scene.locationId || character.id === world.playerId,
  );
}

export function isPresent(world: WorldState, character: Character): boolean {
  return character.locationId === world.scene.locationId;
}

/** What is in play in the current scene, with whatever `text` names as the cue. */
export function sceneFocus(world: WorldState, text = ''): RecallFocus {
  const around = new Set<string>(presentCharacters(world).map((character) => character.id));
  if (world.scene.locationId) around.add(world.scene.locationId);
  return { cues: new Set(mentionedIds(world, text)), around, turn: world.turn, query: text };
}

/**
 * The world as the game master is shown it. Everything is there except the
 * full memory of every character, which would grow without bound: characters
 * in play (present, or named in the player's words) come with up to
 * `perCharacter` memories that bear on this moment, and the rest only with a count.
 * Of the play modules, only the state of those in `modules` is shown: the game
 * master should not try to keep up a board it has no tools for.
 */
export function gameMasterView(
  world: WorldState,
  playerText: string,
  perCharacter = 8,
  modules: readonly ModuleId[] = MODULE_IDS,
): unknown {
  const focus = sceneFocus(world, playerText);
  const characters = Object.fromEntries(
    Object.values(world.characters).map((character) => {
      const inPlay = focus.around.has(character.id) || focus.cues.has(character.id);
      const memories = inPlay ? recall(character.memories, focus, perCharacter) : [];
      const omitted = character.memories.length - memories.length;
      return [character.id, { ...character, memories, ...(omitted > 0 ? { memories_not_shown: omitted } : {}) }];
    }),
  );
  const states = Object.fromEntries(Object.entries(world.modules).filter(([id]) => modules.includes(id as ModuleId)));
  if (world.modules.custom) {
    const custom = Object.fromEntries(
      Object.entries(world.modules.custom).filter(([id]) => modules.includes(id as ModuleId)),
    );
    if (Object.keys(custom).length > 0) states.custom = custom;
  }
  const { storySummary, summarizedUpToTurn: _summarizedUpToTurn, ...rest } = world;
  return {
    ...rest,
    ...(storySummary ? { storySummary } : {}),
    characters,
    modules: states,
  };
}
