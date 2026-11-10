import type { EventMessage, WorldState } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';
import { describeEvent } from '../../lib/describe';
import { useUi } from '../../store/ui';

export function EventRow({ events, world }: { events: EventMessage[]; world: WorldState }) {
  const { t } = useTranslation();
  const showSecrets = useUi((s) => s.showSecrets);
  const isSecretLore = (id: string) => !showSecrets && world.lore[id]?.hidden === true;

  const chips = events.flatMap((message) => {
    const view = describeEvent(t, message.event, isSecretLore);
    return view ? [{ id: message.id, ...view }] : [];
  });
  if (chips.length === 0) return null;

  return (
    <ul className="events">
      {chips.map((chip) => (
        <li key={chip.id} className={`chip chip--${chip.tone}`}>
          <span className="chip__glyph" aria-hidden="true">
            {chip.glyph}
          </span>
          <span className="chip__text">{chip.text}</span>
        </li>
      ))}
    </ul>
  );
}
