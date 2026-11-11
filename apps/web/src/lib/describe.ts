import { bondStage, HOURS_PER_DAY, reputationTier, type Stance, type WorldEvent } from '@roleplay/shared';
import type { TFunction } from 'i18next';
import { isKnownErrorCode, type UiError } from '../api/errors';
import { formatSpan, formatWhen, partOfDay } from './calendar';
import { MODULE_GLYPH } from './modules';
import { formatNumber, formatSigned } from './text';

/** `notice` is for a moment that should stand out: something come due, a bond crossing into a new stage, a fight's end. */
export type EventTone = 'neutral' | 'good' | 'bad' | 'notice';

export interface EventView {
  /** A text glyph (not emoji) identifying the kind of event. */
  glyph: string;
  text: string;
  tone: EventTone;
  /** For a clock: drawn as a small dial in place of the glyph. */
  dial?: { filled: number; segments: number };
}

function formatModifier(modifier: number): string {
  if (modifier > 0) return ` + ${modifier}`;
  if (modifier < 0) return ` − ${Math.abs(modifier)}`;
  return '';
}

function formatChange(from: number | string, to: number | string, max: number | undefined): string {
  return `${from} → ${to}${max !== undefined ? ` / ${max}` : ''}`;
}

const STANCE_TONE: Record<Stance, EventTone> = {
  war: 'bad',
  hostile: 'bad',
  neutral: 'neutral',
  friendly: 'good',
  allied: 'good',
};

export interface DescribeContext {
  /** Hides the title of lore that is (still) a game-master secret. */
  isSecretLore: (id: string) => boolean;
  /** Id of the player's faction on the board, if any: land it takes is good news, land it loses bad. */
  playerFaction: string | null;
  /** Interface language tag, for numbers. */
  locale: string;
}

/**
 * Words a world event as a one-line chip in the interface language. Returns
 * null for event types this client does not know (a newer server), which are
 * not shown, and for events told on cards of their own (components/story:
 * CheckCard, BattleCard, FateCard, CombatStartCard, AttackList, and
 * ClockFilledCard for a clock tick that fills it; see EventRow).
 */
export function describeEvent(t: TFunction, event: WorldEvent, context: DescribeContext): EventView | null {
  const { isSecretLore, playerFaction, locale } = context;
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
    case 'sandbox_round': {
      const base = event.period
        ? t('events.sandbox_round_period', { round: event.round, period: event.period })
        : t('events.sandbox_round', { round: event.round });
      // A round is income coming in, so each change reads as what it added.
      const changes = event.changes
        .map((change) => `${change.resource} ${formatSigned(change.to - change.from, locale)}`)
        .join(t('common.listSeparator'));
      return {
        glyph: '◷',
        tone: 'neutral',
        text: changes ? t('events.sandbox_round_changes', { base, changes }) : base,
      };
    }
    case 'region_taken': {
      const { regionName: region, fromName: from, toName: to } = event;
      let text: string;
      if (from && to) text = t('events.region_taken', { region, from, to });
      else if (to) text = t('events.region_taken_unheld', { region, to });
      else if (from) text = t('events.region_taken_lost', { region, from });
      else text = t('events.region_taken_bare', { region });
      const tone: EventTone =
        playerFaction && event.toId === playerFaction
          ? 'good'
          : playerFaction && event.fromId === playerFaction
            ? 'bad'
            : 'neutral';
      return { glyph: '⚑', tone, text };
    }
    case 'faction_added':
      return { glyph: '✚', tone: 'neutral', text: t('events.faction_added', { name: event.name }) };
    case 'faction_removed':
      return {
        glyph: '✕',
        tone: 'neutral',
        text: event.reason
          ? t('events.faction_removed_reason', { name: event.name, reason: event.reason })
          : t('events.faction_removed', { name: event.name }),
      };
    case 'relation_changed':
      return {
        glyph: '⇌',
        tone: STANCE_TONE[event.stance] ?? 'neutral',
        text: t(`events.relation_changed.${event.stance}`, { a: event.aName, b: event.bName }),
      };
    case 'resource_changed':
      return {
        glyph: event.to > event.from ? '▲' : event.to < event.from ? '▼' : '◆',
        tone: 'neutral',
        text: t('events.resource_changed', {
          faction: event.factionName,
          resource: event.resource,
          change: `${formatNumber(event.from, locale)} → ${formatNumber(event.to, locale)}`,
        }),
      };
    case 'clock_started':
      return {
        glyph: MODULE_GLYPH.clocks,
        dial: { filled: event.filled, segments: event.segments },
        tone: 'neutral',
        text: t('events.clock_started', { name: event.name, filled: event.filled, segments: event.segments }),
      };
    case 'clock_ticked': {
      const values = { name: event.name, from: event.from, to: event.to, segments: event.segments };
      return {
        glyph: MODULE_GLYPH.clocks,
        dial: { filled: event.to, segments: event.segments },
        // A clock drawing closer is a danger or a task advancing; which one is the story's to say.
        tone: 'neutral',
        text: event.to < event.from ? t('events.clock_eased', values) : t('events.clock_ticked', values),
      };
    }
    case 'time_passed': {
      const hours = (event.toDay - event.fromDay) * HOURS_PER_DAY + (event.toHour - event.fromHour);
      const values = {
        span: formatSpan(t, hours),
        when: formatWhen(t, event.toDay, event.toHour, 'inline'),
        part: partOfDay(t, event.toHour),
      };
      // Servers from before `reason` existed send none.
      const reason = typeof event.reason === 'string' ? event.reason.trim() : '';
      return {
        glyph: '◷',
        tone: 'neutral',
        text: reason ? t('events.time_passed_reason', { ...values, reason }) : t('events.time_passed', values),
      };
    }
    case 'schedule_added':
      return {
        glyph: MODULE_GLYPH.calendar,
        tone: 'neutral',
        text: t('events.schedule_added', { title: event.title, when: formatWhen(t, event.day, event.hour, 'inline') }),
      };
    case 'schedule_due':
      return { glyph: '◉', tone: 'notice', text: t('events.schedule_due', { title: event.title }) };
    case 'bond_changed': {
      const change = formatSigned(event.to - event.from, locale);
      const reason = event.reason.trim();
      const before = bondStage(event.from);
      const after = bondStage(event.to);
      if (before !== after) {
        const stage = t(`events.bond_stage.${after}`, { name: event.characterName });
        return {
          glyph: MODULE_GLYPH.bonds,
          tone: 'notice',
          text: reason
            ? t('events.bond_stage_line', { stage, change, reason })
            : t('events.bond_stage_lineBare', { stage, change }),
        };
      }
      const warmer = event.to > event.from;
      const key = warmer ? 'bond_warmer' : 'bond_cooler';
      return {
        glyph: MODULE_GLYPH.bonds,
        tone: warmer ? 'good' : 'bad',
        text: reason
          ? t(`events.${key}`, { name: event.characterName, change, reason })
          : t(`events.${key}Bare`, { name: event.characterName, change }),
      };
    }
    case 'combat_round':
      return { glyph: MODULE_GLYPH.combat, tone: 'neutral', text: t('events.combat_round', { round: event.round }) };
    case 'combat_ended': {
      // No outcome: another fight began while this one was on, and closed it.
      const outcome = event.outcome.trim();
      if (!outcome) return { glyph: MODULE_GLYPH.combat, tone: 'neutral', text: t('events.combat_brokeOff', { count: event.rounds }) };
      return { glyph: MODULE_GLYPH.combat, tone: 'notice', text: t('events.combat_ended', { count: event.rounds, outcome }) };
    }
    case 'shop_opened':
      return { glyph: MODULE_GLYPH.market, tone: 'neutral', text: t('events.shop_opened', { name: event.name }) };
    case 'trade_settled': {
      const key = event.side === 'buy' ? 'trade_bought' : 'trade_sold';
      const tone: EventTone = event.haggleOutcome === 'deal' ? 'good' : 'neutral';
      return {
        glyph: MODULE_GLYPH.market,
        tone,
        text: t(`events.${key}`, {
          item: event.itemName,
          quantity: event.quantity,
          total: event.totalPrice,
          currency: event.currency,
          shop: event.shopName,
        }),
      };
    }
    case 'clue_found':
      return {
        glyph: MODULE_GLYPH.clues,
        tone: 'notice',
        text: event.source
          ? t('events.clue_found_source', { title: event.title, source: event.source })
          : t('events.clue_found', { title: event.title }),
      };
    case 'deduction_made':
      return {
        glyph: MODULE_GLYPH.clues,
        tone: event.status === 'confirmed' ? 'good' : event.status === 'disproven' ? 'bad' : 'notice',
        text: t(`events.deduction_made.${event.status}`, { title: event.title }),
      };
    case 'route_discovered':
      return {
        glyph: MODULE_GLYPH.travel,
        tone: 'neutral',
        text: t('events.route_discovered', { name: event.name, from: event.fromName, to: event.toName }),
      };
    case 'journey_made':
      return {
        glyph: MODULE_GLYPH.travel,
        tone: event.outcome === 'ambush' || event.outcome === 'hazard' ? 'bad' : event.outcome === 'discovery' ? 'good' : 'neutral',
        text: event.arrived
          ? t('events.journey_arrived', {
              from: event.fromName,
              to: event.toName,
              hours: event.hours,
              outcome: t(`world.travel.outcome.${event.outcome}`),
            })
          : t('events.journey_ambushed', {
              from: event.fromName,
              to: event.toName,
              hours: event.hours,
            }),
      };
    case 'card_drawn': {
      const names = event.cards
        .map((c) => (c.reversed ? `${c.name} (${t('world.deck.reversed')})` : c.name))
        .join(t('common.listSeparator'));
      return {
        glyph: MODULE_GLYPH.deck,
        tone: 'notice',
        text: t('events.card_drawn', { deck: event.deckName, cards: names, reason: event.reason }),
      };
    }
    case 'table_rolled':
      return {
        glyph: MODULE_GLYPH.deck,
        tone: 'neutral',
        text: t('events.table_rolled', { table: event.tableName, label: event.label, reason: event.reason }),
      };
    case 'reputation_changed': {
      const delta = event.to - event.from;
      const change = formatSigned(delta, locale);
      const tier = t(`world.reputation.tier.${reputationTier(event.to)}`);
      return {
        glyph: MODULE_GLYPH.reputation,
        tone: delta > 0 ? 'good' : delta < 0 ? 'bad' : 'notice',
        text: event.title
          ? t('events.reputation_changed_title', { name: event.name, change, tier, title: event.title })
          : t('events.reputation_changed', { name: event.name, change, tier }),
      };
    }
    case 'official_appointed':
      return {
        glyph: MODULE_GLYPH.court,
        tone: 'notice',
        text: event.department
          ? t('events.official_appointed_dept', {
              name: event.characterName,
              office: event.office,
              department: event.department,
            })
          : t('events.official_appointed', { name: event.characterName, office: event.office }),
      };
    case 'memorial_submitted':
      return {
        glyph: MODULE_GLYPH.court,
        tone: event.urgency === 'urgent' || event.urgency === 'secret' ? 'notice' : 'neutral',
        text: event.authorName
          ? t('events.memorial_submitted_author', {
              title: event.title,
              author: event.authorName,
              urgency: t(`world.court.urgency.${event.urgency}`),
            })
          : t('events.memorial_submitted', {
              title: event.title,
              urgency: t(`world.court.urgency.${event.urgency}`),
            }),
      };
    case 'memorial_ruled':
      return {
        glyph: MODULE_GLYPH.court,
        tone: event.status === 'approved' ? 'good' : event.status === 'rejected' ? 'bad' : 'neutral',
        text: event.ruling
          ? t('events.memorial_ruled_rescript', {
              title: event.title,
              status: t(`world.court.memorialStatus.${event.status}`),
              ruling: event.ruling,
            })
          : t('events.memorial_ruled', {
              title: event.title,
              status: t(`world.court.memorialStatus.${event.status}`),
            }),
      };
    case 'edict_issued':
      return {
        glyph: MODULE_GLYPH.court,
        tone: 'notice',
        text: event.effect
          ? t('events.edict_issued_effect', { title: event.title, effect: event.effect })
          : t('events.edict_issued', { title: event.title }),
      };
    case 'court_session': {
      const changes = event.changes
        .map((c) => `${c.metric} ${formatSigned(c.to - c.from, locale)}`)
        .join(t('common.listSeparator'));
      const base = t('events.court_session', {
        agenda: event.agenda,
        outcome: t(`world.court.outcome.${event.outcome}`),
        total: event.total,
        target: event.target,
      });
      return {
        glyph: MODULE_GLYPH.court,
        tone:
          event.outcome === 'smooth'
            ? 'good'
            : event.outcome === 'backlash' || event.outcome === 'deadlock'
              ? 'bad'
              : 'notice',
        text: changes ? `${base} · ${changes}` : base,
      };
    }
    case 'consort_invested':
      return {
        glyph: MODULE_GLYPH.lineage,
        tone: 'notice',
        text: event.palace
          ? t('events.consort_invested_palace', {
              name: event.characterName,
              title: event.title,
              palace: event.palace,
            })
          : t('events.consort_invested', { name: event.characterName, title: event.title }),
      };
    case 'heir_designated':
      return {
        glyph: MODULE_GLYPH.lineage,
        tone: 'notice',
        text: event.title
          ? t('events.heir_designated_title', { name: event.characterName, title: event.title })
          : t('events.heir_designated', { name: event.characterName }),
      };
    case 'heir_nurtured': {
      const change = formatSigned(event.to - event.from, locale);
      return {
        glyph: MODULE_GLYPH.lineage,
        tone:
          event.outcome === 'breakthrough' || event.outcome === 'steady'
            ? 'good'
            : event.outcome === 'resisted'
              ? 'bad'
              : 'neutral',
        text: t('events.heir_nurtured', {
          name: event.characterName,
          focus: t(`world.lineage.aptitude.${event.focus}`),
          change,
          outcome: t(`world.lineage.outcome.${event.outcome}`),
        }),
      };
    }
    case 'facility_updated':
      return {
        glyph: MODULE_GLYPH.domain,
        tone: event.status === 'damaged' ? 'bad' : 'neutral',
        text: t('events.facility_updated', {
          name: event.name,
          level: event.level,
          status: t(`world.domain.status.${event.status}`),
        }),
      };
    case 'domain_cycle': {
      const changes = event.changes
        .map((c) => `${c.resource} ${formatSigned(c.to - c.from, locale)}`)
        .join(t('common.listSeparator'));
      const base = event.completedFacility
        ? t('events.domain_cycle_completed', {
            name: event.domainName,
            cycle: event.cycle,
            facility: event.completedFacility,
            outcome: t(`world.domain.outcome.${event.outcome}`),
          })
        : t('events.domain_cycle', {
            name: event.domainName,
            cycle: event.cycle,
            outcome: t(`world.domain.outcome.${event.outcome}`),
          });
      return {
        glyph: MODULE_GLYPH.domain,
        tone:
          event.outcome === 'bountiful' || Boolean(event.completedFacility)
            ? 'good'
            : event.outcome === 'setback'
              ? 'bad'
              : 'neutral',
        text: changes ? `${base} · ${changes}` : base,
      };
    }
    case 'spy_deployed':
      return {
        glyph: MODULE_GLYPH.espionage,
        tone: 'neutral',
        text: t('events.spy_deployed', { codename: event.codename, target: event.targetName }),
      };
    case 'espionage_operation':
      return {
        glyph: MODULE_GLYPH.espionage,
        tone:
          event.compromised || event.outcome === 'blown'
            ? 'bad'
            : event.outcome === 'triumph' || event.outcome === 'success'
              ? 'good'
              : 'notice',
        text: event.compromised
          ? t('events.espionage_compromised', {
              codename: event.codename,
              operation: t(`world.espionage.operation.${event.operation}`),
              target: event.targetName,
            })
          : t('events.espionage_operation', {
              codename: event.codename,
              operation: t(`world.espionage.operation.${event.operation}`),
              target: event.targetName,
              outcome: t(`world.espionage.outcome.${event.outcome}`),
            }),
      };
    case 'dossier_acquired':
      return {
        glyph: MODULE_GLYPH.espionage,
        tone: 'notice',
        text: event.subjectName
          ? t('events.dossier_acquired_subject', { title: event.title, subject: event.subjectName })
          : t('events.dossier_acquired', { title: event.title }),
      };
    case 'ability_learned':
      return {
        glyph: MODULE_GLYPH.progression,
        tone: 'good',
        text: event.rank
          ? t('events.ability_learned_rank', { name: event.name, rank: event.rank })
          : t('events.ability_learned', { name: event.name }),
      };
    case 'realm_breakthrough':
      return {
        glyph: MODULE_GLYPH.progression,
        tone:
          event.outcome === 'transcendent' || event.outcome === 'success'
            ? 'good'
            : event.outcome === 'backlash'
              ? 'bad'
              : 'notice',
        text:
          event.outcome === 'transcendent' || event.outcome === 'success'
            ? t('events.realm_breakthrough_success', {
                from: event.fromRealm,
                to: event.toRealm,
                outcome: t(`world.progression.outcome.${event.outcome}`),
              })
            : t('events.realm_breakthrough_failed', {
                from: event.fromRealm,
                outcome: t(`world.progression.outcome.${event.outcome}`),
              }),
      };
    default:
      return null;
  }
}

/** Localized message for an error; unknown codes fall back to the server's own message. */
export function describeError(t: TFunction, error: UiError): string {
  if (isKnownErrorCode(error.code)) return t(`errors.${error.code}`);
  return error.message || t('errors.generic');
}
