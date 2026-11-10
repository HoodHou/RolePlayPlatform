import type { SandboxState } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';
import { languageTag, useLocale } from '../../i18n';
import { factionStyle, neighborsOf } from '../../lib/sandbox';
import { formatList, formatNumber } from '../../lib/text';

/** What there is to know about one region: shown under the map when it is selected. */
export function RegionDetails({ board, regionId, lang }: { board: SandboxState; regionId: string; lang: string }) {
  const { t } = useTranslation();
  const uiTag = languageTag(useLocale());
  const region = board.regions[regionId];
  if (!region) return null;
  const owner = region.ownerId ? board.factions[region.ownerId] : undefined;
  const neighbors = neighborsOf(board, region.id).map((r) => r.name);

  return (
    <div className="card region-card" style={factionStyle(owner)} aria-live="polite">
      <div className="card__head">
        <h5 className="card__title" lang={lang}>
          {region.name}
        </h5>
        {region.terrain && (
          <span className="tag" lang={lang}>
            {region.terrain}
          </span>
        )}
      </div>
      <dl className="facts">
        <div className="facts__row">
          <dt>{t('world.sandbox.region.owner')}</dt>
          <dd className="region-card__owner">
            <span className={owner ? 'swatch' : 'swatch swatch--unclaimed'} aria-hidden="true" />
            <span lang={owner ? lang : undefined}>{owner?.name ?? t('world.sandbox.unclaimed')}</span>
            {owner?.isPlayer && <span className="tag tag--accent">{t('world.sandbox.you')}</span>}
          </dd>
        </div>
        {region.strength !== null && (
          <div className="facts__row">
            <dt>{t('world.sandbox.region.strength')}</dt>
            <dd className="region-card__number">{formatNumber(region.strength, uiTag)}</dd>
          </div>
        )}
        <div className="facts__row">
          <dt>{t('world.sandbox.region.borders')}</dt>
          <dd lang={neighbors.length > 0 ? lang : undefined}>
            {neighbors.length > 0 ? formatList(neighbors, lang) : t('world.sandbox.region.noBorders')}
          </dd>
        </div>
      </dl>
      {region.description && (
        <p className="card__text" lang={lang}>
          {region.description}
        </p>
      )}
    </div>
  );
}
