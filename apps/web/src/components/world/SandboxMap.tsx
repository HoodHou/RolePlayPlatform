import type { SandboxState } from '@roleplay/shared';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { languageTag, useLocale } from '../../i18n';
import { bordersOf, factionColor, factionStyle, mapBounds, sortedFactions } from '../../lib/sandbox';
import { formatCompact, formatNumber } from '../../lib/text';

interface SandboxMapProps {
  board: SandboxState;
  /** Story language tag, for region names. */
  lang: string;
  selected: string | null;
  onSelect: (regionId: string | null) => void;
  size?: 'compact' | 'large';
}

/**
 * The board as a map: each region a token at its grid cell, coloured by its
 * holder, with borders drawn between neighbours. Only the part of the grid
 * that has regions is drawn. Borders are an SVG layer stretched over the
 * cells; the regions are buttons placed over it, so names stay crisp and
 * legible at any size and every region can be reached by keyboard.
 */
export function SandboxMap({ board, lang, selected, onSelect, size = 'compact' }: SandboxMapProps) {
  const { t } = useTranslation();
  const uiTag = languageTag(useLocale());
  const regions = Object.values(board.regions);
  const bounds = mapBounds(regions);
  if (!bounds) return <p className="tab-empty">{t('world.sandbox.noRegions')}</p>;

  const { minX, minY, columns, rows } = bounds;
  // Cell centres, in cell units (the SVG's own coordinates) and as percentages of the plane.
  const cx = (x: number) => x - minX + 0.5;
  const cy = (y: number) => y - minY + 0.5;

  return (
    <div className={`map map--${size}`} style={{ '--cols': columns, '--rows': rows } as CSSProperties}>
      <div className="map__plane" role="group" aria-label={t('world.sandbox.mapLabel')}>
        <svg
          className="map__lines"
          viewBox={`0 0 ${columns} ${rows}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          {bordersOf(board).map(({ from, to, kind }) => {
            const owner = kind === 'inner' && from.ownerId ? board.factions[from.ownerId] : undefined;
            return (
              <line
                key={`${from.id}|${to.id}`}
                className={`map__border map__border--${kind}`}
                x1={cx(from.x)}
                y1={cy(from.y)}
                x2={cx(to.x)}
                y2={cy(to.y)}
                vectorEffect="non-scaling-stroke"
                style={owner ? { stroke: factionColor(owner.color) } : undefined}
              />
            );
          })}
        </svg>

        {regions.map((region) => {
          const owner = region.ownerId ? board.factions[region.ownerId] : undefined;
          const ownerName = owner?.name ?? t('world.sandbox.unclaimed');
          const isSelected = region.id === selected;
          const classes = ['map__region'];
          // A name in an outer column may only reach as far as the map's margin.
          if (region.x === minX || region.x === minX + columns - 1) classes.push('is-edge');
          if (!owner) classes.push('is-unclaimed');
          if (owner?.isPlayer) classes.push('is-player');
          if (isSelected) classes.push('is-selected');
          const label =
            region.strength !== null
              ? t('world.sandbox.region.labelStrength', {
                  name: region.name,
                  owner: ownerName,
                  n: formatNumber(region.strength, uiTag),
                })
              : t('world.sandbox.region.label', { name: region.name, owner: ownerName });
          return (
            <button
              key={region.id}
              type="button"
              className={classes.join(' ')}
              style={{
                left: `${(cx(region.x) / columns) * 100}%`,
                top: `${(cy(region.y) / rows) * 100}%`,
                ...factionStyle(owner),
              }}
              aria-pressed={isSelected}
              aria-label={label}
              // A long name may be cut short on a crowded map; the tooltip has it whole.
              title={region.name}
              onClick={() => onSelect(isSelected ? null : region.id)}
            >
              <span className="map__token" aria-hidden="true">
                {region.strength !== null ? formatCompact(region.strength, uiTag) : ''}
              </span>
              <span className="map__name" lang={lang} aria-hidden="true">
                {region.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Which colour is whose: the factions on the map, unclaimed land and front lines when there are any. */
export function MapLegend({ board, lang }: { board: SandboxState; lang: string }) {
  const { t } = useTranslation();
  const regions = Object.values(board.regions);
  const holders = new Set(regions.map((r) => r.ownerId));
  const factions = sortedFactions(board).filter((f) => holders.has(f.id));
  const unclaimed = regions.some((r) => !r.ownerId || !board.factions[r.ownerId]);
  const front = bordersOf(board).some((b) => b.kind === 'front');
  if (factions.length === 0 && !unclaimed) return null;

  return (
    <ul className="map-legend">
      {factions.map((faction) => (
        <li key={faction.id} className="map-legend__item" style={factionStyle(faction)}>
          <span className={faction.isPlayer ? 'swatch swatch--player' : 'swatch'} aria-hidden="true" />
          <span lang={lang}>{faction.isPlayer ? t('world.sandbox.yourSide', { name: faction.name }) : faction.name}</span>
        </li>
      ))}
      {unclaimed && (
        <li className="map-legend__item">
          <span className="swatch swatch--unclaimed" aria-hidden="true" />
          {t('world.sandbox.unclaimed')}
        </li>
      )}
      {front && (
        <li className="map-legend__item">
          <span className="map-legend__front" aria-hidden="true" />
          {t('world.sandbox.frontLine')}
        </li>
      )}
    </ul>
  );
}
