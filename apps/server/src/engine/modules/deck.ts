import {
  type CardDeck,
  type DeckCard,
  type DeckState,
  type DrawnCard,
  type RandomTable,
  type WorldEvent,
  type WorldState,
} from '@roleplay/shared';
import { z } from 'zod';
import { asParts, entryReader, id, invalidInput, toJsonSchema, type EntryError, type GameTool, type ToolContext } from '../toolKit';
import { WorldOpError } from '../world';
import type { GameModule } from './types';

/**
 * Decks & Random Tables: non-replacement card decks (prophecy readings,
 * dungeon event decks, mystery draws) and weighted random tables (weather,
 * rumours, loot, strange encounters). Settled on the server via `draw`.
 */

export const DRAW = 'draw';
export const DEFAULT_FATE_DECK_ID = 'fate_deck';

function ensureDeckState(world: WorldState): DeckState {
  return (world.modules.deck ??= {
    decks: {},
    tables: {},
  });
}

/** Built-in 22-card Major Arcana fate deck, ready whenever the GM draws from `fate_deck` without setting one up first. */
export const MAJOR_ARCANA: DeckCard[] = [
  { id: 'arcana_00_fool', name: '0 · The Fool', upright: 'A leap of faith, a fresh beginning, an unexpected path.', reversed: 'Recklessness, walking blind into a trap, hesitation.' },
  { id: 'arcana_01_magician', name: 'I · The Magician', upright: 'Mastery, clever use of tools at hand, willpower.', reversed: 'Trickery, illusions, squandered talent.' },
  { id: 'arcana_02_priestess', name: 'II · The High Priestess', upright: 'Hidden knowledge, intuition, a secret waiting behind the veil.', reversed: 'Withheld truth, surface appearances, ignored warnings.' },
  { id: 'arcana_03_empress', name: 'III · The Empress', upright: 'Abundance, shelter, growth, a generous patron.', reversed: 'Scarcity, smothering control, neglect.' },
  { id: 'arcana_04_emperor', name: 'IV · The Emperor', upright: 'Authority, law, strong walls, a firm hand.', reversed: 'Tyranny, rigid pride, a crumbling command.' },
  { id: 'arcana_05_hierophant', name: 'V · The Hierophant', upright: 'Tradition, oaths, counsel from an old order.', reversed: 'Heresy, broken custom, outworn dogma.' },
  { id: 'arcana_06_lovers', name: 'VI · The Lovers', upright: 'A fateful bond, trust, a crossroads of the heart.', reversed: 'Divided loyalties, temptation, a costly parting.' },
  { id: 'arcana_07_chariot', name: 'VII · The Chariot', upright: 'Swift advance, hard-won momentum, triumph over obstacles.', reversed: 'Loss of control, a stalled march, scattered force.' },
  { id: 'arcana_08_strength', name: 'VIII · Strength', upright: 'Quiet courage, endurance, taming the beast.', reversed: 'Self-doubt, raw fury, giving way under pressure.' },
  { id: 'arcana_09_hermit', name: 'IX · The Hermit', upright: 'Solitude, a guiding lantern, wise withdrawal.', reversed: 'Isolation, losing the trail, refusing counsel.' },
  { id: 'arcana_10_wheel', name: 'X · Wheel of Fortune', upright: 'A sudden turn of luck, destiny in motion.', reversed: 'A downturn, history repeating, bad timing.' },
  { id: 'arcana_11_justice', name: 'XI · Justice', upright: 'Truth weighed fairly, a debt settled, consequence.', reversed: 'Bias, an unpaid reckoning, false accusation.' },
  { id: 'arcana_12_hanged', name: 'XII · The Hanged Man', upright: 'A willing sacrifice, seeing from a new angle, suspension.', reversed: 'Needless martyrdom, stalling, a wasted delay.' },
  { id: 'arcana_13_death', name: 'XIII · Death', upright: 'An irrevocable ending, clearing the old for the new.', reversed: 'Clinging to what is gone, stagnation, slow decay.' },
  { id: 'arcana_14_temperance', name: 'XIV · Temperance', upright: 'Balance, alchemy, a measured middle road.', reversed: 'Excess, clashing extremes, impatience.' },
  { id: 'arcana_15_devil', name: 'XV · The Devil', upright: 'A tempting bargain, chains of debt or obsession.', reversed: 'Breaking free, exposing the strings, a costly release.' },
  { id: 'arcana_16_tower', name: 'XVI · The Tower', upright: 'Sudden upheaval, a false stronghold struck down.', reversed: 'A narrow escape, delaying an inevitable collapse.' },
  { id: 'arcana_17_star', name: 'XVII · The Star', upright: 'Hope after the storm, clear guidance, renewal.', reversed: 'Fading hope, a false beacon, exhaustion.' },
  { id: 'arcana_18_moon', name: 'XVIII · The Moon', upright: 'Deception, shifting shadows, things not as they seem.', reversed: 'A mist clearing, a hidden snare laid bare.' },
  { id: 'arcana_19_sun', name: 'XIX · The Sun', upright: 'Clarity, warmth, open victory, nothing left in shadow.', reversed: 'Overconfidence, a clouded noon, fleeting pride.' },
  { id: 'arcana_20_judgement', name: 'XX · Judgement', upright: 'A reckoning, an old call answered, awakening.', reversed: 'Refusing the call, lingering regret, harsh verdict.' },
  { id: 'arcana_21_world', name: 'XXI · The World', upright: 'Completion, a circle closed, a journey fulfilled.', reversed: 'An unfinished thread, ahollow victory, one last step.' },
];

function createDefaultFateDeck(): CardDeck {
  return {
    id: DEFAULT_FATE_DECK_ID,
    name: 'Deck of Fate',
    description: 'The twenty-two Major Arcana, drawn upright or reversed.',
    reversals: true,
    remaining: MAJOR_ARCANA.map((card) => ({ ...card })),
    drawn: [],
  };
}

// --- the draw tool -----------------------------------------------------------

const drawInput = z.strictObject({
  deck_id: id
    .optional()
    .describe('Id of the card deck to draw from. Pass "fate_deck" to draw from the built-in 22-card Major Arcana deck.'),
  count: z.number().int().min(1).max(10).optional().describe('How many cards to draw from `deck_id`. Defaults to 1.'),
  shuffle_first: z
    .boolean()
    .optional()
    .describe('True to gather all previously drawn cards back into the deck before drawing.'),
  table_id: id.optional().describe('Or id of a weighted random table in `world.modules.deck.tables` to roll on.'),
  reason: z.string().min(1).describe('What the draw or table roll is for, in the story language. Shown to the player.'),
});

const drawTool: GameTool = {
  name: DRAW,
  silent: false,
  records: true,
  endsTurn: false,
  run(world: WorldState, raw: unknown, ctx: ToolContext) {
    const parsed = drawInput.safeParse(raw);
    if (!parsed.success) return invalidInput(parsed.error, raw);
    const input = parsed.data;

    try {
      if ((input.deck_id ? 1 : 0) + (input.table_id ? 1 : 0) !== 1) {
        throw new WorldOpError('Pass either "deck_id" (to draw cards) or "table_id" (to roll on a table), not both.');
      }

      const state = ensureDeckState(world);
      const reason = input.reason.trim();

      if (input.deck_id) {
        if (input.deck_id === DEFAULT_FATE_DECK_ID && !state.decks[DEFAULT_FATE_DECK_ID]) {
          state.decks[DEFAULT_FATE_DECK_ID] = createDefaultFateDeck();
        }
        const deck = state.decks[input.deck_id];
        if (!deck) {
          throw new WorldOpError(
            `There is no deck with id "${input.deck_id}". Create it in record.deck or use "${DEFAULT_FATE_DECK_ID}".`,
          );
        }

        if (input.shuffle_first && deck.drawn.length > 0) {
          // Put drawn cards back when we still know their faces; for the default fate deck, restore full cards.
          if (deck.id === DEFAULT_FATE_DECK_ID) {
            deck.remaining = MAJOR_ARCANA.map((card) => ({ ...card }));
          } else {
            const restored: DeckCard[] = deck.drawn.map((d) => ({
              id: d.id,
              name: d.name,
              upright: d.meaning,
              reversed: '',
            }));
            deck.remaining.push(...restored);
          }
          deck.drawn = [];
        }

        if (deck.remaining.length === 0) {
          throw new WorldOpError(
            `Deck "${deck.name}" has no cards remaining. Pass "shuffle_first": true or reset it in record.deck.`,
          );
        }

        const count = Math.min(input.count ?? 1, deck.remaining.length);
        const cardsDrawn: { id: string; name: string; reversed: boolean; meaning: string }[] = [];

        for (let i = 0; i < count; i++) {
          const index = Math.floor(ctx.random() * deck.remaining.length);
          const [card] = deck.remaining.splice(index, 1);
          if (!card) break;
          const reversed = deck.reversals ? ctx.random() < 0.5 : false;
          const meaning = reversed && card.reversed ? card.reversed : card.upright;
          const drawnEntry: DrawnCard = {
            id: card.id,
            name: card.name,
            reversed,
            meaning,
            turn: world.turn,
            reason,
          };
          deck.drawn.push(drawnEntry);
          cardsDrawn.push({ id: card.id, name: card.name, reversed, meaning });
        }

        const event: WorldEvent = {
          type: 'card_drawn',
          deckId: deck.id,
          deckName: deck.name,
          cards: cardsDrawn,
          remaining: deck.remaining.length,
          reason,
        };

        return {
          content: JSON.stringify({
            deck: deck.name,
            drawn: cardsDrawn,
            remaining: deck.remaining.length,
            reason,
          }),
          isError: false,
          events: [event],
        };
      }

      // table_id branch
      const table = state.tables[input.table_id!];
      if (!table) {
        throw new WorldOpError(`There is no random table with id "${input.table_id}". Create it in record.deck first.`);
      }
      if (table.entries.length === 0) {
        throw new WorldOpError(`Random table "${table.name}" has no entries.`);
      }

      const totalWeight = table.entries.reduce((sum, entry) => sum + Math.max(1, entry.weight), 0);
      const roll = Math.floor(ctx.random() * totalWeight) + 1;
      let cursor = 0;
      let chosen = table.entries[table.entries.length - 1]!;
      for (const entry of table.entries) {
        cursor += Math.max(1, entry.weight);
        if (roll <= cursor) {
          chosen = entry;
          break;
        }
      }

      const event: WorldEvent = {
        type: 'table_rolled',
        tableId: table.id,
        tableName: table.name,
        entryId: chosen.id,
        label: chosen.label,
        description: chosen.description,
        roll,
        totalWeight,
        reason,
      };

      return {
        content: JSON.stringify({
          table: table.name,
          roll,
          total_weight: totalWeight,
          result: {
            id: chosen.id,
            label: chosen.label,
            description: chosen.description,
          },
          reason,
        }),
        isError: false,
        events: [event],
      };
    } catch (err) {
      if (err instanceof WorldOpError) return { content: err.message, isError: true, events: [] };
      throw err;
    }
  },
};

// --- record.deck: creating and resetting decks and tables --------------------

const cardSchema = z.strictObject({
  id,
  name: z.string().min(1).describe('Name on the face of the card.'),
  upright: z.string().optional().describe('Meaning when drawn (or when drawn upright).'),
  reversed: z.string().optional().describe('Meaning when drawn reversed.'),
});

const deckEntrySchema = z.strictObject({
  id,
  name: z.string().optional().describe('Name of the deck. Required when creating.'),
  description: z.string().optional().describe('What the deck is used for.'),
  reversals: z.boolean().optional().describe('True if drawn cards have a 50% chance of coming up reversed.'),
  cards: z.array(cardSchema).max(78).optional().describe('Cards in the draw pile. Replaces the remaining pile when given.'),
  reset: z.boolean().optional().describe('True to shuffle all drawn cards back into the remaining pile.'),
  remove: z.boolean().optional().describe('True to remove this deck.'),
});

const tableRowSchema = z.strictObject({
  id,
  label: z.string().min(1).describe('Short name of the outcome.'),
  description: z.string().optional().describe('Details for the game master when this row comes up.'),
  weight: z.number().int().min(1).max(100).optional().describe('Relative weight (defaults to 1).'),
});

const tableEntrySchema = z.strictObject({
  id,
  name: z.string().optional().describe('Name of the random table. Required when creating.'),
  description: z.string().optional().describe('When this table is rolled on.'),
  entries: z.array(tableRowSchema).min(1).max(50).optional().describe('Rows of the random table.'),
  remove: z.boolean().optional().describe('True to remove this table.'),
});

const deckSection = z
  .strictObject({
    decks: z.array(deckEntrySchema).max(8).optional().describe('Card decks to create, restock, reset, or remove.'),
    tables: z.array(tableEntrySchema).max(12).optional().describe('Weighted random tables to create, update, or remove.'),
  })
  .describe('Card decks (drawn without replacement) and weighted random tables.');

function upsertDeck(world: WorldState, entry: z.infer<typeof deckEntrySchema>): WorldEvent[] {
  const state = ensureDeckState(world);
  const existing = state.decks[entry.id];

  if (entry.remove) {
    if (!existing) throw new WorldOpError(`There is no deck with id "${entry.id}".`);
    delete state.decks[entry.id];
    return [];
  }

  const name = entry.name?.trim();
  if (!existing && !name && entry.id !== DEFAULT_FATE_DECK_ID) {
    throw new WorldOpError(`Deck "${entry.id}" does not exist yet. Include "name" and "cards" to create it.`);
  }

  const deck: CardDeck =
    existing ??
    (entry.id === DEFAULT_FATE_DECK_ID
      ? createDefaultFateDeck()
      : {
          id: entry.id,
          name: name ?? '',
          description: '',
          reversals: entry.reversals ?? false,
          remaining: [],
          drawn: [],
        });

  if (existing && name) deck.name = name;
  if (entry.description !== undefined) deck.description = entry.description;
  if (entry.reversals !== undefined) deck.reversals = entry.reversals;

  if (entry.reset) {
    if (deck.id === DEFAULT_FATE_DECK_ID && !entry.cards) {
      deck.remaining = MAJOR_ARCANA.map((c) => ({ ...c }));
    } else {
      for (const drawn of deck.drawn) {
        deck.remaining.push({
          id: drawn.id,
          name: drawn.name,
          upright: drawn.meaning,
          reversed: '',
        });
      }
    }
    deck.drawn = [];
  }

  if (entry.cards) {
    deck.remaining = entry.cards.map((card) => ({
      id: card.id,
      name: card.name.trim(),
      upright: card.upright ?? '',
      reversed: card.reversed ?? '',
    }));
    if (!existing || entry.reset) deck.drawn = [];
  }

  state.decks[deck.id] = deck;
  return [];
}

function upsertTable(world: WorldState, entry: z.infer<typeof tableEntrySchema>): WorldEvent[] {
  const state = ensureDeckState(world);
  const existing = state.tables[entry.id];

  if (entry.remove) {
    if (!existing) throw new WorldOpError(`There is no random table with id "${entry.id}".`);
    delete state.tables[entry.id];
    return [];
  }

  const name = entry.name?.trim();
  if (!existing && !name) {
    throw new WorldOpError(`Random table "${entry.id}" does not exist yet. Include "name" and "entries" to create it.`);
  }
  if (!existing && !entry.entries) {
    throw new WorldOpError(`Random table "${entry.id}" needs "entries".`);
  }

  const table: RandomTable = existing ?? {
    id: entry.id,
    name: name ?? '',
    description: '',
    entries: [],
  };

  if (existing && name) table.name = name;
  if (entry.description !== undefined) table.description = entry.description;
  if (entry.entries) {
    table.entries = entry.entries.map((row) => ({
      id: row.id,
      label: row.label.trim(),
      description: row.description ?? '',
      weight: row.weight ?? 1,
    }));
  }

  state.tables[table.id] = table;
  return [];
}

function applyDeck(world: WorldState, section: unknown, errors: EntryError[]): WorldEvent[] {
  const parts = asParts(section, 'deck', errors);
  if (!parts) return [];

  const events: WorldEvent[] = [];
  const reader = entryReader(parts, 'deck.', errors, events);
  reader.rejectUnknown(['decks', 'tables'], 'deck field');

  reader.each('decks', deckEntrySchema, (entry) => upsertDeck(world, entry));
  reader.each('tables', tableEntrySchema, (entry) => upsertTable(world, entry));

  return events;
}

const en = `## Card decks and random tables

You have card decks and weighted random tables under record.deck, and the draw tool to pull from them.

Card decks draw without replacement: once a card is drawn it stays out of the pile until the deck is reshuffled. You can call draw with deck_id: "fate_deck" at any time without prior setup to draw from a built-in 22-card Major Arcana tarot deck (upright or reversed), or define your own custom decks in record.deck.decks (such as an exploration deck, a court intrigue deck, or a curse deck).

Weighted random tables in record.deck.tables let you define setting-specific tables (wandering encounters, tavern rumours, strange weather, loot) and roll on them with draw by passing table_id. Always weave the drawn card or rolled table result into the turn's narration.`;

const zh = `## 牌堆与随机表

你在 record.deck 下拥有牌堆与加权随机表，并配有 draw 工具来抽牌或掷表。

牌堆采用不放回抽牌：一张牌抽出后不会再次出现，直到洗回牌堆。你可以随时调用 draw 并传入 deck_id: "fate_deck"，无需预先配置即可从内置的 22 张大阿卡那命运牌堆中抽牌（含正位与逆位释义）；也可以在 record.deck.decks 中创建自定义牌堆（如地牢探索牌、朝堂变故牌、奇物牌）。

在 record.deck.tables 中可以定义贴合世界观的加权随机表（如路途奇遇、酒馆传闻、异象天气、战利品），再用 draw 传入 table_id 由服务端按权重抽取。每次抽牌或掷表后，把结果自然地织入本回合的叙述中。`;

export const deckModule: GameModule = {
  id: 'deck',
  keptWhenUnused: true,
  hasPanel: true,
  tools: [
    {
      tool: drawTool,
      spec: {
        name: DRAW,
        description:
          'Draw one or more cards without replacement from a deck (use deck_id "fate_deck" for the built-in 22-card Major Arcana deck), or roll a weighted entry on a random table. Call before narrating the result.',
        inputSchema: toJsonSchema(drawInput),
      },
    },
  ],
  record: { schema: deckSection, apply: applyDeck },
  guide: { en, zh },
};
