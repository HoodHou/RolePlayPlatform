import type {
  AttackOutcome,
  BreakthroughOutcome,
  CheckDifficulty,
  CheckOutcome,
  ClueKind,
  CombatSide,
  CourtDomain,
  CourtOutcome,
  DeductionStatus,
  DiceSystem,
  DomainCycleOutcome,
  EspionageOperation,
  FacilityStatus,
  FateAnswer,
  FateOdds,
  FateTwist,
  HaggleOutcome,
  HeirAptitudeKey,
  JourneyOutcome,
  MemorialStatus,
  MemorialUrgency,
  NurtureIntensity,
  NurtureOutcome,
  OperationOutcome,
  RouteHazard,
  Stance,
  TravelPace,
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
    }
  // --- market module ---
  | {
      type: 'shop_opened';
      id: string;
      name: string;
    }
  | {
      type: 'trade_settled';
      side: 'buy' | 'sell';
      shopId: string;
      shopName: string;
      itemId: string;
      itemName: string;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
      currency: string;
      balance: number | null;
      haggled: boolean;
      haggleRoll: number | null;
      haggleOutcome: HaggleOutcome | null;
    }
  // --- clues module (hidden clues are never announced) ---
  | {
      type: 'clue_found';
      id: string;
      title: string;
      kind: ClueKind;
      source: string;
    }
  | {
      type: 'deduction_made';
      id: string;
      title: string;
      status: DeductionStatus;
    }
  // --- travel module ---
  | {
      type: 'route_discovered';
      id: string;
      name: string;
      fromName: string;
      toName: string;
      hazard: RouteHazard;
    }
  | {
      type: 'journey_made';
      routeId: string | null;
      routeName: string;
      fromId: string;
      fromName: string;
      toId: string;
      toName: string;
      pace: TravelPace;
      hours: number;
      hazard: RouteHazard;
      roll: number;
      outcome: JourneyOutcome;
      arrived: boolean;
    }
  // --- deck module ---
  | {
      type: 'card_drawn';
      deckId: string;
      deckName: string;
      cards: { id: string; name: string; reversed: boolean; meaning: string }[];
      remaining: number;
      reason: string;
    }
  | {
      type: 'table_rolled';
      tableId: string;
      tableName: string;
      entryId: string;
      label: string;
      description: string;
      roll: number;
      totalWeight: number;
      reason: string;
    }
  // --- reputation module ---
  | {
      type: 'reputation_changed';
      id: string;
      name: string;
      from: number;
      to: number;
      title: string;
      heat: number;
      reason: string;
    }
  // --- court module ---
  | {
      type: 'official_appointed';
      characterId: string;
      characterName: string;
      office: string;
      department: string;
      rank: string;
    }
  | {
      type: 'memorial_submitted';
      id: string;
      title: string;
      authorName: string;
      urgency: MemorialUrgency;
    }
  | {
      type: 'memorial_ruled';
      id: string;
      title: string;
      status: Exclude<MemorialStatus, 'pending'>;
      ruling: string;
    }
  | {
      type: 'edict_issued';
      id: string;
      title: string;
      effect: string;
    }
  | {
      type: 'court_session';
      agenda: string;
      domain: CourtDomain;
      leadName: string;
      oppositionName: string;
      roll: number;
      bonus: number;
      total: number;
      target: number;
      outcome: CourtOutcome;
      changes: { metric: string; from: number; to: number }[];
    }
  // --- lineage module ---
  | {
      type: 'consort_invested';
      characterId: string;
      characterName: string;
      title: string;
      palace: string;
    }
  | {
      type: 'heir_designated';
      characterId: string;
      characterName: string;
      title: string;
    }
  | {
      type: 'heir_nurtured';
      characterId: string;
      characterName: string;
      tutorName: string;
      focus: HeirAptitudeKey;
      intensity: NurtureIntensity;
      rolls: number[];
      bonus: number;
      total: number;
      outcome: NurtureOutcome;
      from: number;
      to: number;
    }
  // --- domain module ---
  | {
      type: 'facility_updated';
      id: string;
      name: string;
      level: number;
      status: FacilityStatus;
      stewardName: string;
    }
  | {
      type: 'domain_cycle';
      domainName: string;
      cycle: number;
      facilityName: string;
      stewardName: string;
      roll: number;
      bonus: number;
      total: number;
      outcome: DomainCycleOutcome;
      completedFacility: string;
      changes: { resource: string; from: number; to: number }[];
    }
  // --- espionage module ---
  | {
      type: 'spy_deployed';
      id: string;
      codename: string;
      targetName: string;
      cover: string;
    }
  | {
      type: 'espionage_operation';
      agentId: string;
      codename: string;
      operation: EspionageOperation;
      targetName: string;
      roll: number;
      chance: number;
      outcome: OperationOutcome;
      infiltration: number;
      exposure: number;
      compromised: boolean;
      reason: string;
    }
  | {
      type: 'dossier_acquired';
      id: string;
      title: string;
      subjectName: string;
      verified: boolean;
    }
  // --- progression module ---
  | {
      type: 'ability_learned';
      id: string;
      name: string;
      category: string;
      rank: string;
    }
  | {
      type: 'realm_breakthrough';
      fromRealm: string;
      toRealm: string;
      roll: number;
      chance: number;
      outcome: BreakthroughOutcome;
      deviation: number;
      reason: string;
    };

export const BATTLE_MARGINS = ['narrow', 'clear', 'decisive'] as const;
export type BattleMargin = (typeof BATTLE_MARGINS)[number];

export type WorldEventType = WorldEvent['type'];
