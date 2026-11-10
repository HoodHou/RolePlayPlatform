import type { EventMessage, WorldState } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';
import { languageTag, useLocale } from '../../i18n';
import { describeEvent, type EventView } from '../../lib/describe';
import { fillsClock } from '../../lib/modules';
import { boardOf, playerFactionOf } from '../../lib/sandbox';
import { useUi } from '../../store/ui';
import { ClockDial } from '../world/ClockDial';
import { AttackList } from './AttackList';
import { BattleCard } from './BattleCard';
import { CheckCard } from './CheckCard';
import { ClockFilledCard } from './ClockFilledCard';
import { CombatStartCard } from './CombatStartCard';
import { FateCard } from './FateCard';

type Chip = EventView & { id: string };
type Run =
  | { kind: 'chips'; key: string; chips: Chip[] }
  | { kind: 'card'; message: EventMessage }
  | { kind: 'attacks'; key: string; messages: EventMessage[] };

/** Events told on a card of their own rather than as a chip. */
function isCard(message: EventMessage): boolean {
  const { event } = message;
  switch (event.type) {
    case 'check_rolled':
    case 'sandbox_battle':
    case 'fate_asked':
    case 'combat_started':
      return true;
    case 'clock_ticked':
      return fillsClock(event);
    default:
      return false;
  }
}

/**
 * A stretch of consecutive world events. Most are one-line chips that share a
 * wrapping row; a check, a battle, a question to fate, a fight breaking out or
 * a clock filling is told on a card of its own, in place; consecutive blows of
 * a fight share one compact frame.
 */
export function EventRow({ events, world, lang }: { events: EventMessage[]; world: WorldState; lang: string }) {
  const { t } = useTranslation();
  const uiTag = languageTag(useLocale());
  const showSecrets = useUi((s) => s.showSecrets);
  const board = boardOf(world);
  const context = {
    isSecretLore: (id: string) => !showSecrets && world.lore[id]?.hidden === true,
    playerFaction: board ? (playerFactionOf(board)?.id ?? null) : null,
    locale: uiTag,
  };

  const runs: Run[] = [];
  for (const message of events) {
    const last = runs[runs.length - 1];
    if (message.event.type === 'attack_resolved') {
      if (last?.kind === 'attacks') last.messages.push(message);
      else runs.push({ kind: 'attacks', key: message.id, messages: [message] });
      continue;
    }
    if (isCard(message)) {
      runs.push({ kind: 'card', message });
      continue;
    }
    const view = describeEvent(t, message.event, context);
    if (!view) continue;
    if (last?.kind === 'chips') last.chips.push({ id: message.id, ...view });
    else runs.push({ kind: 'chips', key: message.id, chips: [{ id: message.id, ...view }] });
  }
  if (runs.length === 0) return null;

  return (
    <div className="event-group">
      {runs.map((run) => {
        if (run.kind === 'chips') {
          return (
            <ul key={run.key} className="events">
              {run.chips.map((chip) => (
                <li key={chip.id} className={`chip chip--${chip.tone}`}>
                  <span className="chip__glyph" aria-hidden="true">
                    {chip.dial ? <ClockDial segments={chip.dial.segments} filled={chip.dial.filled} size={15} /> : chip.glyph}
                  </span>
                  <span className="chip__text">{chip.text}</span>
                </li>
              ))}
            </ul>
          );
        }
        if (run.kind === 'attacks') return <AttackList key={run.key} messages={run.messages} lang={lang} />;
        const { event } = run.message;
        const key = run.message.id;
        if (event.type === 'check_rolled') return <CheckCard key={key} event={event} lang={lang} />;
        if (event.type === 'sandbox_battle') return <BattleCard key={key} event={event} world={world} lang={lang} />;
        if (event.type === 'fate_asked') return <FateCard key={key} event={event} lang={lang} />;
        if (event.type === 'combat_started') return <CombatStartCard key={key} event={event} lang={lang} />;
        if (event.type === 'clock_ticked') return <ClockFilledCard key={key} event={event} world={world} lang={lang} />;
        return null;
      })}
    </div>
  );
}
