import type { ImageSubject, ModuleId, WorldEvent, WorldState } from '@roleplay/shared';
import { z } from 'zod';
import { WorldOpError } from './world';

/** What a game master tool is made of. Shared by the core tools (tools.ts) and the play modules. */

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
  /**
   * Takes the game master's choice of modules for the story. Present only on
   * the turn in which that choice is its to make.
   */
  chooseModules?: (ids: ModuleId[]) => void;
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

export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

export function invalidInput(error: z.ZodError, input: unknown): ToolOutcome {
  // Tool input arrives unvalidated from the model; say exactly what was wrong so it can resend.
  const content = JSON.stringify({ error: 'invalid_input', issues: z.prettifyError(error), received: input });
  return { content, isError: true, events: [] };
}

// Ids become keys of plain objects. One that names something every object
// already has (`__proto__`, `constructor`, `toString`) would read as existing
// and be written through to all of them.
const isReserved = (value: string) => value in Object.prototype;

export const id = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => !isReserved(value), 'This word is reserved. Choose another id.')
  .describe('Short stable id in lowercase ASCII snake_case. Reuse it to update the same thing later.');

export interface EntryError {
  at: string;
  problem: string;
}

/** A section that should be an object of parts: returns it, or notes the problem and returns nothing. */
export function asParts(section: unknown, at: string, errors: EntryError[]): Record<string, unknown> | undefined {
  if (typeof section === 'object' && section !== null && !Array.isArray(section)) return section as Record<string, unknown>;
  errors.push({ at, problem: 'Must be an object.' });
  return undefined;
}

/**
 * A section that is a list of entries: applies them one at a time, so that a
 * bad one is refused on its own.
 */
export function eachEntry<S extends z.ZodType>(
  section: unknown,
  at: string,
  schema: S,
  errors: EntryError[],
  apply: (entry: z.infer<S>) => WorldEvent[],
): WorldEvent[] {
  const events: WorldEvent[] = [];
  entryReader({ [at]: section }, '', errors, events).each(at, schema, apply);
  return events;
}

/**
 * Reads the parts of a record. Each entry is validated and applied on its own:
 * a failure is noted in `errors` and the rest of the record carries on.
 */
export function entryReader(sections: Record<string, unknown>, path: string, errors: EntryError[], events: WorldEvent[]) {
  const applyEntry = <S extends z.ZodType>(schema: S, value: unknown, at: string, apply: (entry: z.infer<S>) => WorldEvent[]) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      errors.push({ at, problem: z.prettifyError(parsed.error) });
      return;
    }
    try {
      events.push(...apply(parsed.data));
    } catch (err) {
      if (!(err instanceof WorldOpError)) throw err;
      errors.push({ at, problem: err.message });
    }
  };

  return {
    /** A list under `key`, one entry at a time. */
    each<S extends z.ZodType>(key: string, schema: S, apply: (entry: z.infer<S>) => WorldEvent[]): void {
      const value = sections[key];
      if (value === undefined || value === null) return;
      if (!Array.isArray(value)) {
        errors.push({ at: path + key, problem: 'Must be an array.' });
        return;
      }
      value.forEach((entry, index) => applyEntry(schema, entry, `${path}${key}[${index}]`, apply));
    },
    /** A single value under `key`. */
    one<S extends z.ZodType>(key: string, schema: S, apply: (entry: z.infer<S>) => WorldEvent[]): void {
      const value = sections[key];
      if (value === undefined || value === null) return;
      applyEntry(schema, value, path + key, apply);
    },
    /** Notes every key that is not one of `known`. */
    rejectUnknown(known: Iterable<string>, what: string): void {
      const allowed = new Set(known);
      for (const key of Object.keys(sections)) {
        if (!allowed.has(key)) errors.push({ at: path + key, problem: `Unknown ${what}.` });
      }
    },
  };
}
