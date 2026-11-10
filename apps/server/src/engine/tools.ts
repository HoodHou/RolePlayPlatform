import { IMAGE_SUBJECTS, type ImageSubject, type WorldEvent, type WorldState } from '@roleplay/shared';
import { z } from 'zod';
import type { ToolSpec } from '../llm/types';
import { rollDice } from './dice';
import {
  removeEntity,
  resolvePictureTarget,
  setScene,
  setSuggestions,
  updateWorld,
  upsertCharacter,
  upsertItem,
  upsertLocation,
  upsertLore,
  upsertQuest,
  WorldOpError,
} from './world';

/**
 * The game master's tools: its only way to reach the player and the world.
 *
 * There are three, on purpose. Some models send several tool calls in one
 * response and others only ever send one, so a tool per kind of change would
 * cost the second kind a round trip for every character, item and quest. With
 * `narrate` for the story and one `record` call for everything it changed, a
 * turn is one response for a model that batches and two for one that does not.
 */

export const NARRATE = 'narrate';
export const ROLL_DICE = 'roll_dice';
export const RECORD = 'record';

export interface PictureRequest {
  subject: ImageSubject;
  /** The character, location or item pictured; null for a scene. */
  targetId: string | null;
  prompt: string;
  caption: string;
}

export interface ToolContext {
  /** Injected so tests can make dice deterministic. */
  random: () => number;
  /** Puts a passage of story in front of the player. */
  narrate(text: string): void;
  /**
   * Starts painting in the background and returns at once. Absent when
   * illustrations are off. Throws WorldOpError when it will not paint.
   */
  requestPicture?: (request: PictureRequest) => void;
}

export interface ToolOutcome {
  /** Sent back to the model. */
  content: string;
  isError: boolean;
  events: WorldEvent[];
}

export interface GameTool {
  name: string;
  /**
   * A call whose result the model has no need to read. When every call in a
   * step is silent and succeeds, nothing is waiting on another model round trip.
   */
  silent: boolean;
  /** Whether the call writes to the world, as opposed to telling the story or rolling dice. */
  records: boolean;
  /** The model's signal that it is done with the turn. */
  endsTurn: boolean;
  run(world: WorldState, input: unknown, ctx: ToolContext): ToolOutcome;
}

function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

function invalidInput(error: z.ZodError, input: unknown): ToolOutcome {
  // Tool input arrives unvalidated from the model; say exactly what was wrong so it can resend.
  const content = JSON.stringify({ error: 'invalid_input', issues: z.prettifyError(error), received: input });
  return { content, isError: true, events: [] };
}

// --- narrate ------------------------------------------------------------------
// Narration is a tool rather than the model's plain reply for two reasons. Text
// written alongside tool calls is not reliably delivered verbatim (the newest
// Claude models return it as hidden progress notes), and as a tool input it
// can be streamed to the player while the record that follows is still being
// written.

const narrateSchema = z.strictObject({
  text: z
    .string()
    .min(1)
    .describe('The narration, in the story language. Blank lines between paragraphs, *asterisks* for emphasis, speech in quotation marks.'),
});

const narrate: GameTool = {
  name: NARRATE,
  silent: true,
  records: false,
  endsTurn: false,
  run(_world, input, ctx) {
    const parsed = narrateSchema.safeParse(input);
    if (!parsed.success) return invalidInput(parsed.error, input);
    ctx.narrate(parsed.data.text);
    return { content: 'ok', isError: false, events: [] };
  },
};

const narrateSpec: ToolSpec = {
  name: NARRATE,
  description:
    'Tell the player what happens. This is the only prose the player reads; anything you write outside this tool is not shown to them. Call it once per turn with the whole passage, before record.',
  inputSchema: toJsonSchema(narrateSchema),
};

// --- roll_dice ----------------------------------------------------------------

const rollDiceSchema = z.strictObject({
  notation: z.string().describe('Dice notation such as "d20", "2d6" or "3d8+2".'),
  reason: z.string().describe('What the roll decides, in the story language. Shown to the player.'),
});

const rollDiceTool: GameTool = {
  name: ROLL_DICE,
  silent: false,
  records: false,
  endsTurn: false,
  run(_world, input, ctx) {
    const parsed = rollDiceSchema.safeParse(input);
    if (!parsed.success) return invalidInput(parsed.error, input);
    const roll = rollDice(parsed.data.notation, ctx.random);
    if (!roll) {
      const content = `Cannot read dice notation "${parsed.data.notation}". Use NdM, NdM+K or NdM-K.`;
      return { content, isError: true, events: [] };
    }
    return {
      content: JSON.stringify({ rolls: roll.rolls, modifier: roll.modifier, total: roll.total }),
      isError: false,
      events: [{ type: 'dice_rolled', ...roll, reason: parsed.data.reason }],
    };
  },
};

const rollDiceSpec: ToolSpec = {
  name: ROLL_DICE,
  description:
    'Roll dice to decide an uncertain outcome: a risky action, a contest, a chance event. Call it before narrating the result and let the roll decide. The result comes back to you and is shown to the player.',
  inputSchema: toJsonSchema(rollDiceSchema),
};

// --- record -------------------------------------------------------------------
// One call carries every change of the turn. Each entry is validated and
// applied on its own, so one bad entry does not throw away the rest.

const id = z
  .string()
  .min(1)
  .max(64)
  .describe('Short stable id in lowercase ASCII snake_case. Reuse it to update the same thing later.');

const stat = z.strictObject({
  name: z.string().min(1).describe('Stat name as the player reads it, e.g. "HP", "Gold", "灵力".'),
  value: z
    .union([z.number(), z.string(), z.null()])
    .describe('New value. A number for anything counted, text otherwise. null removes the stat.'),
  max: z.number().nullable().optional().describe('Upper bound of a numeric stat; the UI then draws it as a gauge.'),
});

const worldSection = z
  .strictObject({
    title: z.string().optional().describe('Name of this world or story.'),
    premise: z.string().optional().describe('A few sentences on the setting, its tone and its rules.'),
    art_style: z
      .string()
      .optional()
      .describe('The look all illustrations of this world share, e.g. "ink wash painting, muted palette".'),
  })
  .describe('The setting itself. Set it when the story begins; change it only if the nature of the world changes.');

const locationEntry = z.strictObject({
  id,
  name: z.string().optional().describe('Required when creating.'),
  description: z.string().optional().describe('What the place is like.'),
  connections: z.array(id).max(12).optional().describe('Ids of places reachable from here. Paths run both ways.'),
});

const characterEntry = z.strictObject({
  id,
  name: z.string().optional().describe('Required when creating.'),
  is_player: z.boolean().optional().describe('True only for the player character. Set at creation.'),
  role: z.string().optional().describe('Short label, e.g. "innkeeper", "rival".'),
  description: z.string().optional().describe('Appearance and background.'),
  personality: z.string().optional().describe('Temperament, goals, manner of speaking.'),
  status: z.string().optional().describe('What they are doing or what condition they are in now.'),
  attitude: z.string().optional().describe('How they feel about the player right now.'),
  location_id: id.nullable().optional().describe('Where they are. Defaults to the current scene. null means whereabouts unknown.'),
  stats: z.array(stat).max(16).optional().describe('Stats to add or change; others stay as they are.'),
});

const itemEntry = z.strictObject({
  id,
  name: z.string().optional().describe('Required when creating.'),
  description: z.string().optional(),
  quantity: z.number().int().min(0).optional().describe('How many. Defaults to 1 when creating; 0 means it is gone.'),
  owner_id: id.nullable().optional().describe('Character id of the owner. Defaults to the player. null means nobody holds it.'),
});

const questEntry = z.strictObject({
  id,
  title: z.string().optional().describe('Required when creating.'),
  description: z.string().optional().describe('What must be done and why it matters.'),
  status: z.enum(['active', 'completed', 'failed']).optional(),
  progress: z.string().optional().describe('One line on how far along it is.'),
});

const loreEntry = z.strictObject({
  id,
  title: z.string().optional().describe('Required when creating.'),
  content: z.string().optional(),
  hidden: z.boolean().optional().describe('True keeps the entry out of the player\'s view. Defaults to false.'),
});

const removal = z.strictObject({
  kind: z.enum(['character', 'location', 'item', 'quest', 'lore']),
  id,
  reason: z.string().optional().describe('Why it is gone, in the story language. Shown to the player for characters.'),
});

const sceneSection = z
  .strictObject({
    location_id: id.optional().describe('Where the player is now. Moving the scene moves the player character with it.'),
    time: z.string().optional().describe('In-world time in whatever form fits the setting, e.g. "Dusk, day 3".'),
    weather: z.string().optional(),
    summary: z.string().optional().describe('One line on the current situation.'),
  })
  .describe('Where and when the story is now. Update it every turn in which time passes or the player moves.');

const pictureEntry = z.strictObject({
  subject: z
    .enum(IMAGE_SUBJECTS)
    .describe('"scene" shows the current moment. "character", "location" and "item" become the portrait of that thing and need its id.'),
  id: id.optional().describe('Id of the character, location or item pictured. Leave out for a scene.'),
  prompt: z
    .string()
    .min(1)
    .describe('What the picture shows, written for an image model that knows nothing about this world: who and what is in frame and what they look like, the setting, light, mood and composition. No lettering, captions or interface elements. The world\'s art style is added for you.'),
  caption: z.string().optional().describe('A short caption in the story language, shown under the picture.'),
});

const suggestions = z
  .array(z.string().min(1))
  .min(1)
  .max(4)
  .describe('Two to four things the player might do next, as short first-person actions in the story language. Shown as buttons; they are suggestions, not the only options.');

const RECORD_SECTIONS = {
  world: worldSection.optional(),
  locations: z
    .array(locationEntry)
    .optional()
    .describe('Places to create or update: the starting area, anywhere the player learns of or travels to, any place that changes.'),
  characters: z
    .array(characterEntry)
    .optional()
    .describe('Characters to create or update: anyone the story will remember, and anyone who changed (mood, condition, attitude, whereabouts, stats). Only the fields you pass change. Create the player character once, with is_player true.'),
  items: z
    .array(itemEntry)
    .optional()
    .describe('Items to create or update: whatever the player gains, loses, uses up or hands over, and items that matter to the story.'),
  quests: z
    .array(questEntry)
    .optional()
    .describe('Goals the player is pursuing: new ones, progress made, completion or failure.'),
  lore: z
    .array(loreEntry)
    .optional()
    .describe('Lasting facts about the world: history, rules, factions, discoveries. Hidden entries are your private notes for secrets, plans and foreshadowing; reveal one by setting hidden to false.'),
  remove: z
    .array(removal)
    .optional()
    .describe('Things gone for good: a character who died or left the story, a destroyed place. Prefer updating status when the thing may matter again.'),
  scene: sceneSection.optional(),
};

const PICTURES = z
  .array(pictureEntry)
  .max(2)
  .optional()
  .describe('Pictures to paint and show the player. Keep them for moments worth seeing: the opening scene, arriving somewhere striking, an important character\'s first appearance (as their portrait). Painting is slow and costs money, so most turns need none.');

const recordSchema = z.strictObject({ ...RECORD_SECTIONS, suggestions });
const recordSchemaWithPictures = z.strictObject({ ...RECORD_SECTIONS, pictures: PICTURES, suggestions });

const RECORD_DESCRIPTION =
  'Record everything this turn changed in the world, in one call, and end the turn. The world panels the player sees, and the world state you are given next turn, contain only what has been recorded. Include every section that changed and leave out the rest; suggestions is always required. Call it once, after narrate.';

interface EntryError {
  at: string;
  problem: string;
}

/** Validates and applies one entry; a failure is noted and the rest of the record carries on. */
function applyEntry<S extends z.ZodType>(
  schema: S,
  value: unknown,
  at: string,
  errors: EntryError[],
  apply: (entry: z.infer<S>) => WorldEvent[],
): WorldEvent[] {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    errors.push({ at, problem: z.prettifyError(parsed.error) });
    return [];
  }
  try {
    return apply(parsed.data);
  } catch (err) {
    if (!(err instanceof WorldOpError)) throw err;
    errors.push({ at, problem: err.message });
    return [];
  }
}

const record: GameTool = {
  name: RECORD,
  silent: true,
  records: true,
  endsTurn: true,
  run(world, input, ctx) {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return { content: 'record takes an object of sections.', isError: true, events: [] };
    }
    const sections = input as Record<string, unknown>;
    const errors: EntryError[] = [];
    const events: WorldEvent[] = [];

    const each = <S extends z.ZodType>(key: string, schema: S, apply: (entry: z.infer<S>) => WorldEvent[]) => {
      const value = sections[key];
      if (value === undefined || value === null) return;
      if (!Array.isArray(value)) {
        errors.push({ at: key, problem: 'Must be an array.' });
        return;
      }
      value.forEach((entry, index) => events.push(...applyEntry(schema, entry, `${key}[${index}]`, errors, apply)));
    };
    const one = <S extends z.ZodType>(key: string, schema: S, apply: (entry: z.infer<S>) => WorldEvent[]) => {
      const value = sections[key];
      if (value === undefined || value === null) return;
      events.push(...applyEntry(schema, value, key, errors, apply));
    };

    // Applied in dependency order, whatever order the model listed the sections
    // in: places exist before characters are put in them, and the scene moves last.
    one('world', worldSection, ({ art_style, ...rest }) => updateWorld(world, { ...rest, artStyle: art_style }));
    each('locations', locationEntry, (entry) => upsertLocation(world, entry));
    each('characters', characterEntry, ({ is_player, location_id, ...rest }) =>
      upsertCharacter(world, { ...rest, isPlayer: is_player, locationId: location_id }),
    );
    each('items', itemEntry, ({ owner_id, ...rest }) => upsertItem(world, { ...rest, ownerId: owner_id }));
    each('quests', questEntry, (entry) => upsertQuest(world, entry));
    each('lore', loreEntry, (entry) => upsertLore(world, entry));
    each('remove', removal, (entry) => removeEntity(world, entry.kind, entry.id, entry.reason));
    one('scene', sceneSection, ({ location_id, ...rest }) => setScene(world, { ...rest, locationId: location_id }));
    each('pictures', pictureEntry, (entry) => {
      if (!ctx.requestPicture) throw new WorldOpError('Illustrations are switched off.');
      const targetId = resolvePictureTarget(world, entry.subject, entry.id);
      ctx.requestPicture({ subject: entry.subject, targetId, prompt: entry.prompt, caption: entry.caption ?? '' });
      return [];
    });
    one('suggestions', suggestions, (actions) => setSuggestions(world, actions));
    if (sections.suggestions === undefined) errors.push({ at: 'suggestions', problem: 'Required.' });

    const known = new Set([...Object.keys(RECORD_SECTIONS), 'pictures', 'suggestions']);
    for (const key of Object.keys(sections)) {
      if (!known.has(key)) errors.push({ at: key, problem: 'Unknown section.' });
    }

    if (errors.length === 0) return { content: 'ok', isError: false, events };
    const content = JSON.stringify({
      error: 'some_entries_rejected',
      rejected: errors,
      note: 'Everything else was applied. Call record again with only the corrected entries and suggestions.',
    });
    return { content, isError: true, events };
  },
};

function recordSpec(schema: z.ZodType): ToolSpec {
  return { name: RECORD, description: RECORD_DESCRIPTION, inputSchema: toJsonSchema(schema) };
}

// --- registry -----------------------------------------------------------------

// Declaration order is also the order calls of one step run in: the story is
// told before its consequences are announced.
const tools: GameTool[] = [narrate, rollDiceTool, record];
const byName = new Map(tools.map((tool) => [tool.name, tool]));
const order = new Map(tools.map((tool, index) => [tool.name, index]));

const specs = [narrateSpec, rollDiceSpec, recordSpec(recordSchema)];
const specsWithPictures = [narrateSpec, rollDiceSpec, recordSpec(recordSchemaWithPictures)];

/**
 * The tools offered to the game master. Pictures are only part of `record`
 * when something can actually paint. Both lists are fixed, so either one caches.
 */
export function getToolSpecs(options: { illustrations: boolean }): ToolSpec[] {
  return options.illustrations ? specsWithPictures : specs;
}

export function getTool(name: string): GameTool | undefined {
  return byName.get(name);
}

/** Sorts one step's calls into the order they should take effect in. */
export function inExecutionOrder<T extends { name: string }>(calls: T[]): T[] {
  return [...calls].sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));
}
