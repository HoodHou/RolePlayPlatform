import type {
  AttackOutcome,
  CheckDifficulty,
  CheckOutcome,
  CombatSide,
  DiceSystem,
  FateAnswer,
  FateOdds,
  FateTwist,
  Stance,
} from './modules';

/**
 * Structured notices of what changed in the world. They carry data, not prose,
 * so the UI can word them in its own language.
 */
export type WorldEvent =
  | { type: 'world_named'; title: string }
  | { type: 'scene_changed'; locationId: string; locationName: string }
  | { type: 'location_added'; id: string; name: string }
  | { type: 'character_added'; id: string; name: string; role: string }
  | { type: 'character_removed'; id: string; name: string; reason: string }
  | {
      type: 'stat_changed';
      characterId: string;
      characterName: string;
      isPlayer: boolean;
      stat: string;
      from: number | string;
      to: number | string;
      max?: number;
    }
  | { type: 'item_gained'; id: string; name: string; quantity: number }
  | { type: 'item_lost'; id: string; name: string; quantity: number }
  | { type: 'quest_started'; id: string; title: string }
  | { type: 'quest_updated'; id: string; title: string; progress: string }
  | { type: 'quest_completed'; id: string; title: string }
  | { type: 'quest_failed'; id: string; title: string }
  | { type: 'lore_added'; id: string; title: string }
  | {
      type: 'dice_rolled';
      notation: string;
      rolls: number[];
      modifier: number;
      total: number;
      reason: string;
    }
  // --- dice module ---
  | {
      /** A check against a character's stat, rolled and judged by the server. */
      type: 'check_rolled';
      characterId: string;
      characterName: string;
      isPlayer: boolean;
      /**
       * The stat that was tested: under the name the sheet gives it, or as the
       * game master named it when the sheet has no such number. Empty when the
       * check named none.
       */
      stat: string;
      system: DiceSystem;
      difficulty: CheckDifficulty;
      /** Every die rolled, in order. */
      rolls: number[];
      /** The dice that counted: one of two with an edge under d20 or d100, two of three under 2d6. */
      kept: number[];
      /** d20 and 2d6: what was added to the dice (stat plus modifiers). Always 0 under d100. */
      bonus: number;
      /** d20 and 2d6: kept dice plus bonus. d100: the roll itself. */
      total: number;
      /** d20: the number to meet. d100: the number to roll at or under. 2d6: 10, a full success. */
      target: number;
      outcome: CheckOutcome;
      reason: string;
    }
  // --- sandbox module ---
  | {
      /** A round passed on the board. `changes` is what it did to the holdings of the player's own faction. */
      type: 'sandbox_round';
      round: number;
      period: string;
      changes: { resource: string; from: number; to: number }[];
    }
  | {
      type: 'sandbox_battle';
      attackerId: string;
      attackerName: string;
      defenderId: string;
      defenderName: string;
      /** Where it was fought, when it was fought over a region. */
      regionId: string | null;
      regionName: string;
      attackerForce: number;
      defenderForce: number;
      attackerLosses: number;
      defenderLosses: number;
      winner: 'attacker' | 'defender';
      margin: BattleMargin;
      reason: string;
    }
  | {
      /** A region changed hands. A side is null, and its name empty, when nobody held it before or holds it now. */
      type: 'region_taken';
      regionId: string;
      regionName: string;
      fromId: string | null;
      fromName: string;
      toId: string | null;
      toName: string;
    }
  | { type: 'faction_added'; id: string; name: string }
  | { type: 'faction_removed'; id: string; name: string; reason: string }
  | { type: 'relation_changed'; aName: string; bName: string; stance: Stance }
  | {
      /**
       * The player's own faction gained or lost something outside of battles and
       * the passing of rounds, which report it themselves. `resource` is its display name.
       */
      type: 'resource_changed';
      factionId: string;
      factionName: string;
      resource: string;
      from: number;
      to: number;
    }
  // --- oracle module ---
  | {
      /** The game master put a question about the world to fate. */
      type: 'fate_asked';
      question: string;
      odds: FateOdds;
      /** The chance of a yes, in percent. */
      chance: number;
      /** 1 to 100; a yes at or under `chance`. */
      roll: number;
      answer: FateAnswer;
      /** Thrown in on a double (11, 22, ... 99). */
      twist: FateTwist | null;
    }
  // --- clocks module (hidden clocks are never announced) ---
  | { type: 'clock_started'; id: string; name: string; segments: number; filled: number }
  | {
      /** `to` equal to `segments` means it has filled: what it was counting toward happens. */
      type: 'clock_ticked';
      id: string;
      name: string;
      from: number;
      to: number;
      segments: number;
    }
  // --- calendar module ---
  | {
      type: 'time_passed';
      fromDay: number;
      fromHour: number;
      toDay: number;
      toHour: number;
      /** What filled the time, in the story language. Empty when the clock was simply set forward. */
      reason: string;
    }
  | { type: 'schedule_added'; id: string; title: string; day: number; hour: number | null }
  | {
      /** Something scheduled has come due. Hidden entries are not announced. */
      type: 'schedule_due';
      id: string;
      title: string;
    }
  // --- bonds module ---
  | {
      /** A character grew closer to the player or further away. Stages follow from the scores (`bondStage`). */
      type: 'bond_changed';
      characterId: string;
      characterName: string;
      from: number;
      to: number;
      reason: string;
    }
  // --- combat module ---
  | {
      type: 'combat_started';
      /** In the order they will act. */
      combatants: { id: string; name: string; side: CombatSide; initiative: number }[];
    }
  | {
      type: 'attack_resolved';
      attackerId: string;
      attackerName: string;
      attackerSide: CombatSide;
      targetId: string;
      targetName: string;
      targetSide: CombatSide;
      /** Every d20 rolled; two with an edge. */
      rolls: number[];
      /** The d20 that counted. */
      kept: number;
      bonus: number;
      /** `kept` plus `bonus`. */
      total: number;
      /** What it had to meet. */
      defense: number;
      outcome: AttackOutcome;
      /** As asked for, e.g. "1d8+2". */
      damageNotation: string;
      /** The damage dice as they fell (twice as many on a critical); empty on a miss. */
      damageRolls: number[];
      /** What the target lost; 0 on a miss. */
      damage: number;
      targetHp: number;
      targetMaxHp: number;
      /** The blow took the target out of the fight. */
      targetDown: boolean;
      reason: string;
    }
  | { type: 'combat_round'; round: number }
  | {
      type: 'combat_ended';
      rounds: number;
      /** How it ended, in the story language. Empty when the fight was simply cut short by another one beginning. */
      outcome: string;
    };

export const BATTLE_MARGINS = ['narrow', 'clear', 'decisive'] as const;
export type BattleMargin = (typeof BATTLE_MARGINS)[number];

export type WorldEventType = WorldEvent['type'];
