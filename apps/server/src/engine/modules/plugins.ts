import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  MODULE_CATEGORIES,
  MODULE_IDS,
  type CustomModuleState,
  type ModuleCategory,
  type ModuleId,
  type PluginLibraryMeta,
  type PluginManifest,
  type PluginToolSpec,
  type WorldEvent,
  type WorldState,
} from '@roleplay/shared';
import { z } from 'zod';
import { rollDice } from '../dice';
import { eachEntry, id, invalidInput, toJsonSchema, type EntryError, type GameTool, type ToolContext } from '../toolKit';
import { WorldOpError } from '../world';
import type { GameModule } from './types';

/**
 * External plugin system: compiles declarative JSON manifests (`PluginManifest`)
 * into first-class `GameModule` instances with validated `record.<id>` schemas,
 * server-side tools (`roll`, `table`, `counter`), character visibility, and
 * bilingual library metadata.
 */

const BUILTIN_IDS = new Set<string>(MODULE_IDS);
const RESERVED_TOOL_NAMES = new Set([
  'narrate',
  'record',
  'paint',
  'roll_dice',
  'check',
  'fight',
  'ask_fate',
  'simulate',
  'trade',
  'journey',
  'draw',
]);

const localizedTextSchema = z.strictObject({
  en: z.string().min(1).max(4000),
  zh: z.string().min(1).max(4000),
});

const pluginFieldSchema = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  label: localizedTextSchema,
  type: z.enum(['string', 'number', 'boolean']),
  description: z.string().max(400).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

const pluginToolSchema = z.strictObject({
  name: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,31}$/)
    .refine((name) => !RESERVED_TOOL_NAMES.has(name), 'Tool name is already used by a built-in tool.'),
  description: z.string().min(1).max(600),
  kind: z.enum(['roll', 'table', 'counter']),
  dice: z.string().max(16).optional(),
  target: z.number().int().optional(),
  rollUnder: z.boolean().optional(),
  entries: z
    .array(
      z.strictObject({
        label: z.string().min(1).max(200),
        description: z.string().max(500).optional(),
        weight: z.number().int().min(1).max(100).optional(),
      }),
    )
    .max(50)
    .optional(),
  counterKey: z.string().max(32).optional(),
  signature: z.string().max(120).optional(),
  uiDescription: localizedTextSchema.optional(),
});

export const pluginManifestSchema: z.ZodType<PluginManifest> = z.strictObject({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,31}$/, 'Plugin id must be lowercase ASCII snake_case (2-32 chars).')
    .refine((val) => !BUILTIN_IDS.has(val) && val !== 'cards', 'Plugin id cannot shadow a built-in or reserved module id.'),
  category: z.enum(MODULE_CATEGORIES),
  glyph: z.string().min(1).max(4).optional(),
  name: localizedTextSchema,
  tagline: localizedTextSchema,
  description: localizedTextSchema,
  guide: localizedTextSchema,
  keptWhenUnused: z.boolean().optional(),
  reachesCharacters: z.boolean().optional(),
  record: z
    .strictObject({
      description: z.string().min(1).max(600),
      uiDescription: localizedTextSchema.optional(),
      fields: z.array(pluginFieldSchema).min(1).max(16),
    })
    .optional(),
  tools: z.array(pluginToolSchema).max(4).optional(),
});

export interface CompiledPlugin {
  manifest: PluginManifest;
  module: GameModule;
  category: ModuleCategory;
  meta: PluginLibraryMeta;
}

function ensureCustomState(world: WorldState, manifest: PluginManifest): CustomModuleState {
  const custom = (world.modules.custom ??= {});
  return (custom[manifest.id] ??= {
    id: manifest.id,
    name: manifest.name.en,
    entries: {},
  });
}

function buildPluginTool(manifest: PluginManifest, spec: PluginToolSpec): { tool: GameTool; spec: { name: string; description: string; inputSchema: Record<string, unknown> } } {
  if (spec.kind === 'roll') {
    const schema = z.strictObject({
      notation: z.string().optional().describe(`Dice notation to roll (defaults to "${spec.dice ?? '2d6'}").`),
      modifier: z.number().int().min(-50).max(50).optional().describe('Flat modifier added to the roll.'),
      target: z.number().int().optional().describe('Target number to compare against.'),
      reason: z.string().min(1).describe('Why this roll is being made, in the story language.'),
    });
    const tool: GameTool = {
      name: spec.name,
      silent: false,
      records: false,
      endsTurn: false,
      run(_world: WorldState, raw: unknown, ctx: ToolContext) {
        const parsed = schema.safeParse(raw);
        if (!parsed.success) return invalidInput(parsed.error, raw);
        const notation = parsed.data.notation ?? spec.dice ?? '2d6';
        const rolled = rollDice(notation, ctx.random);
        if (!rolled) {
          return { content: `Invalid dice notation "${notation}".`, isError: true, events: [] };
        }
        const extraMod = parsed.data.modifier ?? 0;
        const total = rolled.total + extraMod;
        const target = parsed.data.target ?? spec.target;
        const success =
          target !== undefined ? (spec.rollUnder ? total <= target : total >= target) : undefined;
        const event: WorldEvent = {
          type: 'dice_rolled',
          notation,
          rolls: rolled.rolls,
          modifier: rolled.modifier + extraMod,
          total,
          reason: parsed.data.reason.trim(),
        };
        return {
          content: JSON.stringify({
            tool: spec.name,
            notation,
            rolls: rolled.rolls,
            modifier: rolled.modifier + extraMod,
            total,
            ...(target !== undefined ? { target, success } : {}),
            reason: parsed.data.reason.trim(),
          }),
          isError: false,
          events: [event],
        };
      },
    };
    return {
      tool,
      spec: {
        name: spec.name,
        description: spec.description,
        inputSchema: toJsonSchema(schema),
      },
    };
  }

  if (spec.kind === 'table') {
    const schema = z.strictObject({
      reason: z.string().min(1).describe('What this table roll is for, in the story language.'),
    });
    const rows = spec.entries && spec.entries.length > 0 ? spec.entries : [{ label: 'Nothing unusual', weight: 1 }];
    const tool: GameTool = {
      name: spec.name,
      silent: false,
      records: false,
      endsTurn: false,
      run(_world: WorldState, raw: unknown, ctx: ToolContext) {
        const parsed = schema.safeParse(raw);
        if (!parsed.success) return invalidInput(parsed.error, raw);
        const totalWeight = rows.reduce((sum, r) => sum + Math.max(1, r.weight ?? 1), 0);
        const roll = Math.floor(ctx.random() * totalWeight) + 1;
        let cursor = 0;
        let chosen = rows[rows.length - 1]!;
        let chosenIdx = rows.length - 1;
        for (let i = 0; i < rows.length; i++) {
          cursor += Math.max(1, rows[i]!.weight ?? 1);
          if (roll <= cursor) {
            chosen = rows[i]!;
            chosenIdx = i;
            break;
          }
        }
        const event: WorldEvent = {
          type: 'table_rolled',
          tableId: `${manifest.id}_${spec.name}`,
          tableName: manifest.name.en,
          entryId: `row_${chosenIdx}`,
          label: chosen.label,
          description: chosen.description ?? '',
          roll,
          totalWeight,
          reason: parsed.data.reason.trim(),
        };
        return {
          content: JSON.stringify({
            tool: spec.name,
            roll,
            total_weight: totalWeight,
            result: { label: chosen.label, description: chosen.description ?? '' },
            reason: parsed.data.reason.trim(),
          }),
          isError: false,
          events: [event],
        };
      },
    };
    return {
      tool,
      spec: {
        name: spec.name,
        description: spec.description,
        inputSchema: toJsonSchema(schema),
      },
    };
  }

  // kind === 'counter'
  const counterKey = spec.counterKey ?? 'value';
  const schema = z.strictObject({
    entry_id: id.describe('Id of the tracked entry.'),
    name: z.string().optional().describe('Display name when creating a new entry.'),
    delta: z.number().int().optional().describe('Amount to add or subtract.'),
    set: z.number().int().optional().describe('Or set the counter to this value outright.'),
  });
  const tool: GameTool = {
    name: spec.name,
    silent: false,
    records: true,
    endsTurn: false,
    run(world: WorldState, raw: unknown) {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) return invalidInput(parsed.error, raw);
      const state = ensureCustomState(world, manifest);
      const existing = state.entries[parsed.data.entry_id];
      const entry = existing ?? {
        id: parsed.data.entry_id,
        name: parsed.data.name?.trim() || parsed.data.entry_id,
        values: {},
      };
      if (parsed.data.name?.trim()) entry.name = parsed.data.name.trim();
      const prev = typeof entry.values[counterKey] === 'number' ? (entry.values[counterKey] as number) : 0;
      const next = parsed.data.set ?? prev + (parsed.data.delta ?? 0);
      entry.values[counterKey] = next;
      state.entries[entry.id] = entry;
      return {
        content: JSON.stringify({
          entry_id: entry.id,
          name: entry.name,
          [counterKey]: next,
          previous: prev,
        }),
        isError: false,
        events: [],
      };
    },
  };
  return {
    tool,
    spec: {
      name: spec.name,
      description: spec.description,
      inputSchema: toJsonSchema(schema),
    },
  };
}

export function compilePluginManifest(rawManifest: unknown): CompiledPlugin {
  const manifest = pluginManifestSchema.parse(rawManifest);
  const tools = (manifest.tools ?? []).map((spec) => buildPluginTool(manifest, spec));

  let record: GameModule['record'];
  if (manifest.record) {
    const fieldShape: Record<string, z.ZodType> = {
      id,
      name: z.string().optional().describe('Display name of the entry. Required when creating.'),
      remove: z.boolean().optional().describe('True to remove this entry.'),
    };
    for (const field of manifest.record.fields) {
      let schema: z.ZodType;
      if (field.type === 'number') {
        let num = z.number();
        if (field.min !== undefined) num = num.min(field.min);
        if (field.max !== undefined) num = num.max(field.max);
        schema = num.optional();
      } else if (field.type === 'boolean') {
        schema = z.boolean().optional();
      } else {
        schema = z.string().optional();
      }
      if (field.description) schema = schema.describe(field.description);
      fieldShape[field.key] = schema;
    }

    const entrySchema = z.strictObject(fieldShape);
    const sectionSchema = z.array(entrySchema).max(20).describe(manifest.record.description);

    record = {
      schema: sectionSchema,
      apply(world: WorldState, section: unknown, errors: EntryError[]): WorldEvent[] {
        return eachEntry(section, manifest.id, entrySchema, errors, (rawEntry) => {
          const entry = rawEntry as { id: string; name?: string; remove?: boolean } & Record<string, unknown>;
          const state = ensureCustomState(world, manifest);
          const existing = state.entries[entry.id];
          if (entry.remove) {
            if (!existing) throw new WorldOpError(`There is no ${manifest.id} entry with id "${entry.id}".`);
            delete state.entries[entry.id];
            return [];
          }
          const name = entry.name?.trim();
          if (!existing && !name) {
            throw new WorldOpError(`Entry "${entry.id}" in ${manifest.id} does not exist yet. Include "name" to create it.`);
          }
          const item = existing ?? { id: entry.id, name: name ?? '', values: {} };
          if (existing && name) item.name = name;
          for (const field of manifest.record!.fields) {
            const val = entry[field.key];
            if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
              item.values[field.key] = val;
            }
          }
          state.entries[item.id] = item;
          return [];
        });
      },
    };
  }

  const toolsMeta: PluginLibraryMeta['tools'] = {};
  for (const spec of manifest.tools ?? []) {
    toolsMeta[spec.name] = {
      signature: spec.signature ?? `${spec.name}(...)`,
      description: spec.uiDescription ?? { en: spec.description, zh: spec.description },
    };
  }

  const meta: PluginLibraryMeta = {
    glyph: manifest.glyph ?? '✦',
    name: manifest.name,
    tagline: manifest.tagline,
    description: manifest.description,
    tools: toolsMeta,
    ...(manifest.record?.uiDescription
      ? { recordDescription: manifest.record.uiDescription }
      : manifest.record
        ? { recordDescription: { en: manifest.record.description, zh: manifest.record.description } }
        : {}),
  };

  const module: GameModule = {
    id: manifest.id as ModuleId,
    keptWhenUnused: manifest.keptWhenUnused ?? true,
    hasPanel: Boolean(manifest.record),
    tools,
    ...(record
      ? {
          record,
          operate(world: WorldState, op: string, params: Record<string, unknown>, ctx) {
            if (op === 'update_entry') {
              const errors: EntryError[] = [];
              const events = record.apply(world, [params], errors, ctx);
              if (errors.length > 0) throw new WorldOpError(errors.map((e) => e.problem).join('; '));
              const entryId = typeof params.id === 'string' ? params.id : '';
              const label = world.modules.custom?.[manifest.id]?.entries[entryId]?.name ?? entryId;
              return { events, summary: `${manifest.name.zh || manifest.name.en}：更新 ${label}` };
            }
            throw new WorldOpError(`Unknown plugin operation "${op}".`);
          },
        }
      : {}),
    guide: {
      en: `## ${manifest.name.en}\n\n${manifest.guide.en}`,
      zh: `## ${manifest.name.zh}\n\n${manifest.guide.zh}`,
    },
    ...(manifest.reachesCharacters
      ? {
          shownToCharacter: {
            tag: `plugin_${manifest.id}`,
            of(world: WorldState) {
              const state = world.modules.custom?.[manifest.id];
              if (!state || Object.keys(state.entries).length === 0) return undefined;
              return Object.values(state.entries);
            },
          },
        }
      : {}),
  };

  return {
    manifest,
    module,
    category: manifest.category,
    meta,
  };
}

/**
 * Disk-backed store for external plugin manifests in `<dataDir>/plugins/*.json`.
 */
export class PluginStore {
  private readonly dir: string;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'plugins');
  }

  async loadAll(): Promise<CompiledPlugin[]> {
    try {
      const files = await readdir(this.dir);
      const compiled: CompiledPlugin[] = [];
      for (const file of files.sort()) {
        if (!file.endsWith('.json')) continue;
        try {
          const text = await readFile(path.join(this.dir, file), 'utf8');
          compiled.push(compilePluginManifest(JSON.parse(text)));
        } catch {
          // Skip unreadable or invalid plugin files rather than preventing boot.
        }
      }
      return compiled;
    } catch {
      return [];
    }
  }

  async save(rawManifest: unknown): Promise<CompiledPlugin> {
    const compiled = compilePluginManifest(rawManifest);
    await mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, `${compiled.manifest.id}.json`);
    await writeFile(file, JSON.stringify(compiled.manifest, null, 2), 'utf8');
    return compiled;
  }

  async remove(pluginId: string): Promise<boolean> {
    const file = path.join(this.dir, `${pluginId}.json`);
    try {
      await rm(file);
      return true;
    } catch {
      return false;
    }
  }
}
