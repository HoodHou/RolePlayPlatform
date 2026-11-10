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
    };

export type WorldEventType = WorldEvent['type'];
