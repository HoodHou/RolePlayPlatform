import { bondStage } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';
import { languageTag, useLocale } from '../../i18n';
import { BOND_THRESHOLDS, bondPosition } from '../../lib/bonds';
import { formatSigned } from '../../lib/text';

/**
 * Where a bond stands on the scale from −100 to 100: a bar that grows from
 * the middle (a stranger) toward the stage it has reached, with the stage
 * boundaries marked. `compact` is the small one on a character's card.
 */
export function BondMeter({ score, name, compact = false }: { score: number; name: string; compact?: boolean }) {
  const { t } = useTranslation();
  const uiTag = languageTag(useLocale());
  const stage = bondStage(score);
  const at = bondPosition(score);
  const from = Math.min(at, 50);
  const width = Math.abs(at - 50);

  return (
    <div
      className={`bond-meter stage--${stage}${compact ? ' bond-meter--compact' : ''}`}
      role="meter"
      aria-label={t('world.bonds.scaleLabel', {
        name,
        stage: t(`world.bonds.stage.${stage}`),
        score: formatSigned(score, uiTag),
      })}
      aria-valuemin={-100}
      aria-valuemax={100}
      aria-valuenow={score}
    >
      <span className="bond-meter__fill" style={{ left: `${from}%`, width: `${width}%` }} />
      {!compact &&
        BOND_THRESHOLDS.map((threshold) => (
          <span key={threshold} className="bond-meter__tick" style={{ left: `${bondPosition(threshold)}%` }} />
        ))}
      <span className="bond-meter__zero" />
      <span className="bond-meter__marker" style={{ left: `${at}%` }} />
    </div>
  );
}

/** A bond in a few words: its stage, a small meter and the score, for a character's card. */
export function BondBadge({ score, name }: { score: number; name: string }) {
  const { t } = useTranslation();
  const uiTag = languageTag(useLocale());
  const stage = bondStage(score);
  return (
    <span className={`bond-badge stage--${stage}`}>
      <span className="bond-badge__stage">{t(`world.bonds.stage.${stage}`)}</span>
      <BondMeter score={score} name={name} compact />
      <span className="bond-badge__score" aria-hidden="true">
        {formatSigned(score, uiTag)}
      </span>
    </span>
  );
}
