import type { Clue, CluesState, Deduction, WorldState } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';
import { useUi } from '../../store/ui';
import { SecretsSwitch } from './SecretsSwitch';

export function visibleClues(world: WorldState, showSecrets: boolean): { clues: Clue[]; deductions: Deduction[] } {
  const state = world.modules?.clues;
  if (!state) return { clues: [], deductions: [] };
  const clues = Object.values(state.clues).filter((clue) => showSecrets || !clue.hidden);
  const deductions = Object.values(state.deductions);
  return { clues, deductions };
}

function DeductionCard({
  deduction,
  state,
  lang,
}: {
  deduction: Deduction;
  state: CluesState;
  lang: string;
}) {
  const { t } = useTranslation();
  const linkedClues = deduction.clueIds
    .map((id) => state.clues[id])
    .filter((clue): clue is Clue => Boolean(clue && !clue.hidden));

  return (
    <li className="card">
      <div className="card__head">
        <h4 className="card__title" lang={lang}>
          {deduction.title}
        </h4>
        <span className="tag">{t(`world.clues.deductionStatus.${deduction.status}`)}</span>
      </div>
      {deduction.conclusion && (
        <p className="card__text" lang={lang}>
          {deduction.conclusion}
        </p>
      )}
      {linkedClues.length > 0 && (
        <div className="places__links">
          <span className="card__label">{t('world.clues.supportedBy')}</span>
          <ul className="chips">
            {linkedClues.map((clue) => (
              <li key={clue.id} className="chip" lang={lang}>
                {clue.title}
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

function ClueCard({
  clue,
  state,
  showSecrets,
  lang,
}: {
  clue: Clue;
  state: CluesState;
  showSecrets: boolean;
  lang: string;
}) {
  const { t } = useTranslation();
  const linked = clue.links
    .map((id) => state.clues[id])
    .filter((other): other is Clue => Boolean(other && (showSecrets || !other.hidden)));

  return (
    <li className={`card${clue.hidden ? ' is-secret' : ''}`}>
      <div className="card__head">
        <h4 className="card__title" lang={lang}>
          {clue.title}
        </h4>
        <span className="tag">{t(`world.clues.kind.${clue.kind}`)}</span>
        {clue.hidden && <span className="tag tag--secret">{t('world.clocks.secret')}</span>}
      </div>
      {clue.source && (
        <p className="card__meta" lang={lang}>
          {t('world.clues.source')}: {clue.source}
        </p>
      )}
      {clue.description && (
        <p className="card__text" lang={lang}>
          {clue.description}
        </p>
      )}
      {linked.length > 0 && (
        <div className="places__links">
          <span className="card__label">{t('world.clues.links')}</span>
          <ul className="chips">
            {linked.map((other) => (
              <li key={other.id} className="chip" lang={lang}>
                {other.title}
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

/** Read-only view of the investigation clue board: deductions and discovered clues. */
export function CluesTab({ world, lang }: { world: WorldState; lang: string }) {
  const { t } = useTranslation();
  const showSecrets = useUi((s) => s.showSecrets);
  const state = world.modules?.clues;
  if (!state) return null;

  const { clues, deductions } = visibleClues(world, showSecrets);

  return (
    <div className="clues">
      <SecretsSwitch warning={t('world.clues.secretsWarning')} />
      {deductions.length > 0 && (
        <section className="world-section">
          <h3 className="eyebrow">{t('world.clues.deductionsTitle')}</h3>
          <ul className="cards">
            {deductions.map((deduction) => (
              <DeductionCard key={deduction.id} deduction={deduction} state={state} lang={lang} />
            ))}
          </ul>
        </section>
      )}
      {clues.length > 0 && (
        <section className="world-section">
          <h3 className="eyebrow">{t('world.clues.cluesTitle')}</h3>
          <ul className="cards">
            {clues.map((clue) => (
              <ClueCard key={clue.id} clue={clue} state={state} showSecrets={showSecrets} lang={lang} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
