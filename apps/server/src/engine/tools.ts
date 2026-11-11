import { CHRONICLE_KINDS, IMAGE_SUBJECTS, MODULE_IDS, type ModuleId, type WorldEvent } from '@roleplay/shared';
import { z } from 'zod';
import type { ToolSpec } from '../llm/types';
import { getModules, modulesKey, type GameModule } from './modules';
import { entryReader, id, invalidInput, toJsonSchema, type EntryError, type GameTool } from './toolKit';
import {
  addMemory,
  keepPlayerInScene,
  removeEntity,
  resolvePictureTarget,
  setScene,
  setSuggestions,
  updateStoryArc,
  updateWorld,
  upsertCharacter,
  upsertChronicle,
  upsertItem,
  upsertLocation,
  upsertLore,
  upsertQuest,
  WorldOpError,
} from './world';

export { toJsonSchema, type GameTool, type PictureRequest, type ToolContext, type ToolOutcome } from './toolKit';

/**
 * The game master's tools: its only way to reach the player and the world.
 *
 * The core is two, on purpose. Some models send several tool calls in one
 * response and others only ever send one, so a tool per kind of change would
 * cost the second kind a round trip for every character, item and quest. With
 * `narrate` for the story and one `record` call for everything it changed, a
 * turn is one response for a model that batches and two for one that does not.
 *
 * Play modules (see modules/) add to both: instruments of their own, such as
 * dice, whose results the game master needs before it can tell the story, and
 * a section each in `record` for what they keep.
 */

export const NARRATE = 'narrate';
export const RECORD = 'record';

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

// --- record -------------------------------------------------------------------
// One call carries every change of the turn. Each entry is validated and
// applied on its own, so one bad entry does not throw away the rest.

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
  description: z.string().optional().describe('Background, history, and public identity.'),
  appearance: z
    .string()
    .optional()
    .describe('Concrete visual traits for consistent portraits: age, face, hair, build, signature attire.'),
  personality: z.string().optional().describe('Temperament, goals, manner of speaking.'),
  status: z.string().optional().describe('What they are doing or what condition they are in now.'),
  attitude: z.string().optional().describe('How they feel about the player right now.'),
  location_id: id
    .nullable()
    .optional()
    .describe('Where they are. Always give it for someone who is not in the scene with the player: left out, a new character is placed in the current scene. null means whereabouts unknown.'),
  stats: z.array(stat).max(16).optional().describe('Stats to add or change; others stay as they are.'),
  voice: z
    .string()
    .optional()
    .describe('How they speak: register, rhythm, pet phrases, with a line or two of sample speech. Used when they talk to the player themselves, so make it distinctive.'),
  goals: z.string().optional().describe('What they want right now and are working toward.'),
  secrets: z.string().optional().describe('What they are hiding and from whom. Never shown to the player.'),
});

const memoryEntry = z.strictObject({
  character_id: id.describe('Who remembers this. Not the player character.'),
  text: z
    .string()
    .min(1)
    .describe('The memory from their point of view, in their own words: what they saw, heard, said or did, and what they made of it. Only what they could know, and specific: the names, times and places involved, and what was actually said.'),
  about: z.array(id).max(8).optional().describe('Ids of the characters, places or things it concerns.'),
  importance: z.number().int().min(1).max(5).optional().describe('1 in passing, 3 worth retelling, 5 never forgotten. Defaults to 2.'),
  told_by: id.optional().describe('Character id of whoever told them, when they did not witness it themselves.'),
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
    summary: z.string().optional().describe('One line on where things stand now. Rewrite it every turn.'),
  })
  .describe('Where and when the story is now. Include it every turn: the summary always, the time whenever any has passed, the location whenever the player has moved.');

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

const storyProgressSection = z
  .strictObject({
    chapter: z.string().optional().describe('Current chapter or act title.'),
    summary: z.string().optional().describe('2-3 sentences on overarching plot state and central tension.'),
    threads: z.array(z.string().min(1)).max(6).optional().describe('Active unresolved plot threads.'),
  })
  .describe('Macro story progression. Set on turn 1 and update when the overall arc shifts.');

const chronicleEntry = z.strictObject({
  id: id.optional().describe('Optional stable id to create or update.'),
  kind: z.enum(CHRONICLE_KINDS).optional(),
  title: z.string().optional().describe('Short milestone headline. Required when creating.'),
  summary: z.string().optional().describe('1-2 factual sentences on what happened.'),
  impact: z.string().optional().describe('Lasting consequence on stakes, power, or bonds.'),
  secret: z.boolean().optional().describe('True hides a behind-the-scenes milestone from player and NPCs.'),
  public: z.boolean().optional().describe('True broadcasts realm-wide public news to NPCs.'),
});

const RECORD_SECTIONS = {
  world: worldSection.optional(),
  progress: storyProgressSection.optional(),
  chronicle: z
    .array(chronicleEntry)
    .max(6)
    .optional()
    .describe('Pivotal turning points, decrees, battles, alliances, betrayals, or lasting consequences.'),
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
  memories: z
    .array(memoryEntry)
    .optional()
    .describe('What characters will remember of this turn. One entry for each character who witnessed or took part in something they would remember, written from that character\'s point of view. This is the whole of what a character knows: someone who was not there gets no entry and does not know it happened, unless somebody tells them later (then set told_by).'),
};

const PICTURES = z
  .array(pictureEntry)
  .max(2)
  .optional()
  .describe('Pictures to paint and show the player. Keep them for moments worth seeing: the opening scene, arriving somewhere striking, an important character\'s first appearance (as their portrait). Painting is slow and costs money, so most turns need none.');

const RECORD_DESCRIPTION =
  'Record everything this turn changed in the world, in one call, and end the turn. The world panels the player sees, and the world state you are given next turn, contain only what has been recorded. Include every section that changed and leave out the rest; suggestions is always required. Call it once, after narrate.';

// The game master's choice of modules, read leniently: a name it got wrong is
// dropped rather than costing a round trip over a list, and how it capitalised
// one does not matter.
const chosenModules = z.array(z.string()).transform((names) => {
  const named = names.map((name) => name.trim().toLowerCase());
  return { asked: names.length, ids: MODULE_IDS.filter((id) => named.includes(id)) };
});

/**
 * `record` for a story with these modules: the core sections, then one per
 * module that keeps anything. With `choosing`, it also takes the game master's
 * choice of which modules the story keeps.
 */
function makeRecord(modules: GameModule[], choosing: boolean): GameTool {
  const known = [
    ...Object.keys(RECORD_SECTIONS),
    ...modules.filter((module) => module.record).map((module) => module.id),
    ...(choosing ? ['modules'] : []),
    'pictures',
    'suggestions',
  ];

  return {
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
      const { each, one, rejectUnknown } = entryReader(sections, '', errors, events);

      // Applied in dependency order, whatever order the model listed the sections
      // in. Places exist before the scene moves to one; the scene is set before
      // characters arrive, because a newcomer with no stated whereabouts appears
      // where the scene is.
      one('world', worldSection, ({ art_style, ...rest }) => updateWorld(world, { ...rest, artStyle: art_style }));
      one('progress', storyProgressSection, (patch) => updateStoryArc(world, patch));
      each('locations', locationEntry, (entry) => upsertLocation(world, entry));
      one('scene', sceneSection, ({ location_id, ...rest }) => setScene(world, { ...rest, locationId: location_id }));
      each('chronicle', chronicleEntry, (entry) => upsertChronicle(world, entry));
      each('characters', characterEntry, ({ is_player, location_id, ...rest }) =>
        upsertCharacter(world, { ...rest, isPlayer: is_player, locationId: location_id }),
      );
      keepPlayerInScene(world);
      each('items', itemEntry, ({ owner_id, ...rest }) => upsertItem(world, { ...rest, ownerId: owner_id }));
      each('quests', questEntry, (entry) => upsertQuest(world, entry));
      each('lore', loreEntry, (entry) => upsertLore(world, entry));
      each('remove', removal, (entry) => removeEntity(world, entry.kind, entry.id, entry.reason));
      // After scene and characters, so each memory is stamped with the time and place as they now stand.
      each('memories', memoryEntry, ({ character_id, told_by, ...rest }) =>
        addMemory(world, { ...rest, characterId: character_id, toldBy: told_by }),
      );
      // Modules come after the cast they may refer to.
      for (const module of modules) {
        const section = sections[module.id];
        if (module.record && section !== undefined && section !== null) {
          events.push(...module.record.apply(world, section, errors, ctx));
        }
        module.afterRecord?.(world);
      }
      if (choosing) {
        one('modules', chosenModules, ({ asked, ids }) => {
          // A list in which nothing could be recognised says nothing: it must not
          // read as "keep none". An empty list does say that.
          if (ids.length > 0 || asked === 0) ctx.chooseModules?.(ids);
          return [];
        });
      }
      each('pictures', pictureEntry, (entry) => {
        if (!ctx.requestPicture) throw new WorldOpError('Illustrations are switched off.');
        const targetId = resolvePictureTarget(world, entry.subject, entry.id);
        ctx.requestPicture({ subject: entry.subject, targetId, prompt: entry.prompt, caption: entry.caption ?? '' });
        return [];
      });
      one('suggestions', suggestions, (actions) => setSuggestions(world, actions));
      if (sections.suggestions === undefined) errors.push({ at: 'suggestions', problem: 'Required.' });
      rejectUnknown(known, 'section');

      if (errors.length === 0) return { content: 'ok', isError: false, events };
      const content = JSON.stringify({
        error: 'some_entries_rejected',
        rejected: errors,
        note: 'Everything else was applied. Call record again with only the corrected entries and suggestions.',
      });
      return { content, isError: true, events };
    },
  };
}

/**
 * `record` as the model is shown it. The scene is marked required so that it
 * is restated every turn and the header never goes stale; a record that leaves
 * it out is still applied, since rejecting it would cost a round trip.
 */
function recordSpec(modules: GameModule[], illustrations: boolean, choosing: boolean): ToolSpec {
  const moduleSections = Object.fromEntries(
    modules.flatMap((module) => (module.record ? [[module.id, module.record.schema.optional()] as const] : [])),
  );
  const ids = modules.map((module) => module.id);
  const choice = z
    .array(z.enum(ids as [ModuleId, ...ModuleId[]]))
    .describe('The modules this story will use, chosen for its premise: every one you have set up in this record, and every one you expect to need as the story goes on. The ones you leave out are put away after this turn.');
  const schema = z.strictObject({
    ...RECORD_SECTIONS,
    scene: sceneSection,
    ...moduleSections,
    ...(choosing ? { modules: choice } : {}),
    ...(illustrations ? { pictures: PICTURES } : {}),
    suggestions,
  });
  return { name: RECORD, description: RECORD_DESCRIPTION, inputSchema: toJsonSchema(schema) };
}

// --- toolbox ------------------------------------------------------------------

export interface ToolboxOptions {
  /** Pictures are only part of `record` when something can actually paint. */
  illustrations: boolean;
  /** The play modules this story is being played with. */
  modules: readonly ModuleId[];
  /** Whether this is the turn in which the game master says which of them the story keeps. */
  choosing?: boolean;
}

/** The tools the game master has in one story. */
export interface Toolbox {
  /** What the model is offered. */
  specs: ToolSpec[];
  get(name: string): GameTool | undefined;
  /** Sorts one step's calls into the order they should take effect in. */
  inExecutionOrder<T extends { name: string }>(calls: T[]): T[];
}

function buildToolbox(options: ToolboxOptions): Toolbox {
  const modules = getModules(options.modules);
  // With nothing on offer there is nothing to choose between.
  const choosing = options.choosing === true && modules.length > 0;
  const instruments = modules.flatMap((module) => module.tools);
  // Declaration order is also the order calls of one step run in: the story is
  // told before its consequences are announced, and the record comes last.
  const tools = [narrate, ...instruments.map((instrument) => instrument.tool), makeRecord(modules, choosing)];
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const order = new Map(tools.map((tool, index) => [tool.name, index]));

  return {
    specs: [narrateSpec, ...instruments.map((instrument) => instrument.spec), recordSpec(modules, options.illustrations, choosing)],
    get: (name) => byName.get(name),
    inExecutionOrder: (calls) => [...calls].sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0)),
  };
}

const toolboxes = new Map<string, Toolbox>();

/**
 * The toolbox for a set of options. Built once per combination and reused, so
 * the list a model is sent is byte-identical from turn to turn and caches.
 */
export function getToolbox(options: ToolboxOptions): Toolbox {
  const key = `${modulesKey(options.modules)}|${options.illustrations ? 'pictures' : 'plain'}|${options.choosing ? 'choosing' : 'set'}`;
  let toolbox = toolboxes.get(key);
  if (!toolbox) toolboxes.set(key, (toolbox = buildToolbox(options)));
  return toolbox;
}
