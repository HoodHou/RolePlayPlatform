import { useTranslation } from 'react-i18next';
import { languageTag, useLocale } from '../../i18n';
import { diceOf, edgeOf, type CheckEvent } from '../../lib/modules';
import { formatNumber } from '../../lib/text';

/**
 * A check the server rolled and judged: who tried what, the dice (with the
 * one an edge threw away struck through), the total against what it had to
 * beat, and the outcome, toned from critical to fumble. The three rule sets
 * read differently: d20 adds the stat and must meet the target, d100 must come
 * in at or under it, and 2d6 is judged in bands.
 */
export function CheckCard({ event, lang }: { event: CheckEvent; lang: string }) {
  const { t } = useTranslation();
  const uiTag = languageTag(useLocale());
  const num = (value: number) => formatNumber(value, uiTag);

  const stat = event.stat.trim();
  let who: string;
  if (event.isPlayer) who = stat ? t('events.check.player', { stat }) : t('events.check.playerBare');
  else who = stat ? t('events.check.other', { name: event.characterName, stat }) : t('events.check.otherBare', { name: event.characterName });

  const dice = diceOf(event);
  const edge = edgeOf(event);
  // Under d100 the roll is the total and nothing is added. Under d20 a lone die
  // with nothing added needs no sum; 2d6 always does.
  const showBonus = event.system !== 'd100' && event.bonus !== 0;
  const showTotal = event.system === '2d6' || showBonus;
  const target =
    event.system === '2d6'
      ? t('events.check.target.2d6')
      : t(`events.check.target.${event.system}`, { target: num(event.target) });
  // A critical or fumble is the dice speaking, whatever the total: say why.
  const natural = event.outcome === 'critical' || event.outcome === 'fumble' ? event.outcome : null;
  let naturalNote: string | null = null;
  if (natural) {
    naturalNote =
      event.system === 'd100' && natural === 'fumble' && event.total < 100
        ? t('events.check.fumbleLowChance')
        : t(`events.check.natural.${event.system}_${natural}`);
  }

  return (
    <div className={`roll roll--${event.outcome}`}>
      <div className="roll__head">
        <span className="roll__glyph" aria-hidden="true">
          ⚅
        </span>
        <p className="roll__who">
          {who}
          <span className="roll__difficulty"> · {t(`events.check.difficulty.${event.difficulty}`)}</span>
        </p>
        <span className="roll__outcome">{t(`events.check.outcome.${event.outcome}`)}</span>
      </div>
      {event.reason && (
        <p className="roll__reason" lang={lang}>
          {event.reason}
        </p>
      )}
      <p className="roll__math">
        <span className="roll__system">
          {event.system}
          {edge && ` · ${t(`events.check.edge.${edge}`)}`}
        </span>
        <span className="roll__dice">
          {dice.map((die, index) => (
            <span key={index} className={die.kept ? 'die' : 'die is-dropped'}>
              {num(die.value)}
              {!die.kept && <span className="sr-only"> ({t('events.check.notCounted')})</span>}
            </span>
          ))}
        </span>
        {showBonus && (
          <span className="roll__bonus">
            {event.bonus > 0 ? '+' : '−'} {num(Math.abs(event.bonus))}
          </span>
        )}
        {showTotal && <span className="roll__total">= {num(event.total)}</span>}
        <span className="roll__target">{target}</span>
        {naturalNote && <span className="roll__natural">{naturalNote}</span>}
      </p>
    </div>
  );
}
