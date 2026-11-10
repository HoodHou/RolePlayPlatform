import type { WorldEvent } from '@roleplay/shared';
import type { TFunction } from 'i18next';
import { isKnownErrorCode, type UiError } from '../api/errors';

export type EventTone = 'neutral' | 'good' | 'bad';

export interface EventView {
  /** A text glyph (not emoji) identifying the kind of event. */
  glyph: string;
  text: string;
  tone: EventTone;
}

function formatModifier(modifier: number): string {
  if (modifier > 0) return ` + ${modifier}`;
  if (modifier < 0) return ` − ${Math.abs(modifier)}`;
  return '';
}

function formatChange(from: number | string, to: number | string, max: number | undefined): string {
  return `${from} → ${to}${max !== undefined ? ` / ${max}` : ''}`;
}

/**
 * Words a world event in the interface language. `isSecretLore` hides the
 * title of lore that is (still) a game-master secret. Returns null for event
 * types this client does not know (a newer server), which are not shown.
 */
export function describeEvent(
  t: TFunction,
  event: WorldEvent,
  isSecretLore: (id: string) => boolean,
): EventView | null {
  switch (event.type) {
    case 'world_named':
      return { glyph: '✦', tone: 'neutral', text: t('events.world_named', { title: event.title }) };
    case 'scene_changed':
      return { glyph: '⇢', tone: 'neutral', text: t('events.scene_changed', { name: event.locationName }) };
    case 'location_added':
      return { glyph: '⌖', tone: 'neutral', text: t('events.location_added', { name: event.name }) };
    case 'character_added':
      return {
        glyph: '✚',
        tone: 'neutral',
        text: event.role
          ? t('events.character_added_role', { name: event.name, role: event.role })
          : t('events.character_added', { name: event.name }),
      };
    case 'character_removed':
      return {
        glyph: '✕',
        tone: 'bad',
        text: event.reason
          ? t('events.character_removed_reason', { name: event.name, reason: event.reason })
          : t('events.character_removed', { name: event.name }),
      };
    case 'stat_changed': {
      const change = formatChange(event.from, event.to, event.max);
      const rising = typeof event.from === 'number' && typeof event.to === 'number' ? event.to > event.from : null;
      return {
        glyph: rising === null ? '◆' : rising ? '▲' : '▼',
        tone: 'neutral',
        text: event.isPlayer
          ? t('events.stat_changed_player', { stat: event.stat, change })
          : t('events.stat_changed_other', { name: event.characterName, stat: event.stat, change }),
      };
    }
    case 'item_gained':
      return {
        glyph: '⊕',
        tone: 'good',
        text:
          event.quantity > 1
            ? t('events.item_gained_qty', { name: event.name, quantity: event.quantity })
            : t('events.item_gained', { name: event.name }),
      };
    case 'item_lost':
      return {
        glyph: '⊖',
        tone: 'bad',
        text:
          event.quantity > 1
            ? t('events.item_lost_qty', { name: event.name, quantity: event.quantity })
            : t('events.item_lost', { name: event.name }),
      };
    case 'quest_started':
      return { glyph: '❖', tone: 'neutral', text: t('events.quest_started', { title: event.title }) };
    case 'quest_updated':
      return {
        glyph: '✎',
        tone: 'neutral',
        text: event.progress
          ? t('events.quest_updated_progress', { title: event.title, progress: event.progress })
          : t('events.quest_updated', { title: event.title }),
      };
    case 'quest_completed':
      return { glyph: '✓', tone: 'good', text: t('events.quest_completed', { title: event.title }) };
    case 'quest_failed':
      return { glyph: '✗', tone: 'bad', text: t('events.quest_failed', { title: event.title }) };
    case 'lore_added':
      return isSecretLore(event.id)
        ? { glyph: '§', tone: 'neutral', text: t('events.lore_secret') }
        : { glyph: '§', tone: 'neutral', text: t('events.lore_added', { title: event.title }) };
    case 'dice_rolled': {
      const values = {
        notation: event.notation,
        rolls: event.rolls.length > 0 ? `[${event.rolls.join(', ')}]` : '',
        modifier: formatModifier(event.modifier),
        total: event.total,
      };
      return {
        glyph: '⚅',
        tone: 'neutral',
        text: event.reason
          ? t('events.dice_rolled_reason', { ...values, reason: event.reason })
          : t('events.dice_rolled', values),
      };
    }
    default:
      return null;
  }
}

/** Localized message for an error; unknown codes fall back to the server's own message. */
export function describeError(t: TFunction, error: UiError): string {
  if (isKnownErrorCode(error.code)) return t(`errors.${error.code}`);
  return error.message || t('errors.generic');
}
