import type { Clock, WorldState } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';
import { isFull, visibleClocks } from '../../lib/clocks';
import { useUi } from '../../store/ui';
import { ClockDial } from './ClockDial';
import { ModuleOpButtons } from './ModuleOpControls';
import { SecretsSwitch } from './SecretsSwitch';

function ClockCard({ clock, lang }: { clock: Clock; lang: string }) {
  const { t } = useTranslation();
  const full = isFull(clock);
  const classes = ['card', 'clock', clock.hidden ? 'is-secret' : '', full ? 'is-full' : ''].filter(Boolean).join(' ');

  return (
    <li className={classes}>
      <ClockDial
        segments={clock.segments}
        filled={clock.filled}
        size={52}
        label={t('world.clocks.progressLabel', { name: clock.name, filled: clock.filled, segments: clock.segments })}
      />
      <div className="clock__body">
        <div className="card__head">
          <h4 className="card__title" lang={lang}>
            {clock.name}
          </h4>
          {clock.hidden && <span className="tag tag--secret">{t('world.clocks.secret')}</span>}
        </div>
        <p className="clock__progress">
          <span aria-hidden="true">{t('world.clocks.progress', { filled: clock.filled, segments: clock.segments })}</span>
          {full && <span className="tag clock__full">{t('world.clocks.filled')}</span>}
        </p>
        {clock.description && (
          <p className="card__text clock__when">
            <span className="card__label">{t('world.clocks.whenFull')}</span>
            <span lang={lang}>{clock.description}</span>
          </p>
        )}
        <div className="card__actions">
          <ModuleOpButtons
            directive={{
              moduleId: 'clocks',
              op: 'tick_clock',
              params: { id: clock.id, delta: 1 },
              label: `${clock.name} ${t('world.clocks.ops.tickUp')}`,
            }}
            instantLabel={t('world.clocks.ops.tickUp')}
            disabled={full}
            compact
          />
          {clock.filled > 0 && (
            <ModuleOpButtons
              directive={{
                moduleId: 'clocks',
                op: 'tick_clock',
                params: { id: clock.id, delta: -1 },
                label: `${clock.name} ${t('world.clocks.ops.tickDown')}`,
              }}
              instantLabel={t('world.clocks.ops.tickDown')}
              hideStage
              compact
            />
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * The progress clocks: each a dial with what it counts toward. The game
 * master's hidden clocks appear only with its secrets shown, marked as such.
 */
export function ClocksTab({ world, lang }: { world: WorldState; lang: string }) {
  const { t } = useTranslation();
  const showSecrets = useUi((s) => s.showSecrets);
  const clocks = visibleClocks(world, showSecrets);

  return (
    <div className="clocks">
      <SecretsSwitch warning={t('world.clocks.secretsWarning')} />
      <ul className="cards">
        {clocks.map((clock) => (
          <ClockCard key={clock.id} clock={clock} lang={lang} />
        ))}
      </ul>
    </div>
  );
}
