import type { Character, Locale, ModuleId, WorldEvent, WorldState } from '@roleplay/shared';
import type { z } from 'zod';
import type { ToolSpec } from '../../llm/types';
import type { EntryError, GameTool, ToolContext } from '../toolKit';

export interface ModuleOperationOutcome {
  events: WorldEvent[];
  summary: string;
}

/**
 * A play module, as the engine sees it: everything the game master gains when
 * the module is on. Adding a kind of play (a deck of cards, a shop, a travel
 * map) means writing one of these and listing it in index.ts; the turn loop,
 * the providers and the prompts need no change.
 */
export interface GameModule {
  id: ModuleId;
  /**
   * What becomes of the module when the game master was left to choose a
   * story's modules but did not say which it wanted: true keeps it even if
   * the opening never set it up. For what any story may come to need and
   * costs little to carry.
   */
  keptWhenUnused: boolean;
  /** Whether it keeps state the world panel draws. Told to the library. */
  hasPanel: boolean;
  /**
   * Instruments: tools whose result the server works out and the game master
   * then tells the story from. Not silent, so each use is a model round trip;
   * a module should need at most one per turn.
   */
  tools: { tool: GameTool; spec: ToolSpec }[];
  /** Bookkeeping: the module's own section of `record`, under its id. Costs no round trip. */
  record?: {
    /** The section as the model is shown it. */
    schema: z.ZodType;
    /**
     * Applies the section. What cannot be applied is noted in `errors` and the
     * rest still goes in. The section is an object unless the schema is a list.
     * `ctx.random` is the turn's dice, for a section that has to roll (who acts
     * first in a fight).
     */
    apply(world: WorldState, section: unknown, errors: EntryError[], ctx: Pick<ToolContext, 'random'>): WorldEvent[];
  };
  /**
   * Runs after every record of a story that has the module, whether or not the
   * record had its section: for state that mirrors something recorded elsewhere.
   */
  afterRecord?(world: WorldState): void;
  /**
   * What the game master is told: when the module is for, how to set it up and
   * how to use it. One section of the system prompt, so byte-stable.
   */
  guide: Record<Locale, string>;
  /**
   * What a character speaking for themselves is shown of the module's state,
   * as its own tagged section of their prompt. It must be something that
   * character would know. The actor's instructions (prompts/) say what each tag holds.
   */
  shownToCharacter?: {
    tag: string;
    /** undefined when there is nothing to show yet. */
    of(world: WorldState, characterId: string): unknown;
  };
  /**
   * A part for characters who speak for themselves: extra fields on their
   * `respond` call, and what to do with them. Talk turns never reach the game
   * master's record, so this is the only way such a turn moves the module.
   */
  actor?: {
    fields: Record<string, z.ZodType>;
    apply(world: WorldState, character: Character, reply: Record<string, unknown>): WorldEvent[];
  };
  /**
   * Optional compacted projection of this module's state in `gameMasterView`.
   * Hides unseen card piles or condenses settled history to save input tokens.
   */
  viewForGM?(world: WorldState): unknown;
  /**
   * Direct player-initiated operation handler for interactive UI controls and
   * staged turn directives. Executes deterministically or with server dice at
   * zero LLM token cost when invoked directly.
   */
  operate?(
    world: WorldState,
    op: string,
    params: Record<string, unknown>,
    ctx: Pick<ToolContext, 'random'>,
  ): ModuleOperationOutcome;
}
