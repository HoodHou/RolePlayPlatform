import {
  inferSandboxRegionKind,
  sandboxRegionDefense,
  sandboxRegionStability,
  type SandboxState,
  type WorldState,
} from '@roleplay/shared';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { languageTag, useLocale } from '../../i18n';
import {
  bordersOf,
  factionColor,
  factionStyle,
  mapBounds,
  neighborsOf,
  sortedFactions,
  stanceBetween,
} from '../../lib/sandbox';
import { formatCompact, formatNumber } from '../../lib/text';

export const SANDBOX_LENSES = ['political', 'military', 'governance', 'frontline'] as const;
export type SandboxLens = (typeof SANDBOX_LENSES)[number];

interface SandboxMapProps {
  board: SandboxState;
  world?: WorldState;
  /** Story language tag, for region names. */
  lang: string;
  selected: string | null;
  onSelect: (regionId: string | null) => void;
  size?: 'compact' | 'large';
  lens?: SandboxLens;
}

/**
 * The board as a map: each region a token at its grid cell, shaped by its
 * strategic landmark kind and coloured by its holder or lens, with borders
 * drawn between neighbours.
 */
export function SandboxMap({
  board,
  world,
  lang,
  selected,
  onSelect,
  size = 'compact',
  lens = 'political',
}: SandboxMapProps) {
  const { t } = useTranslation();
  const uiTag = languageTag(useLocale());
  const regions = Object.values(board.regions);
  const bounds = mapBounds(regions);
  if (!bounds) return <p className="tab-empty">{t('world.sandbox.noRegions')}</p>;

  const { minX, minY, columns, rows } = bounds;
  const cx = (x: number) => x - minX + 0.5;
  const cy = (y: number) => y - minY + 0.5;

  const maxStrength = Math.max(1, ...regions.map((r) => r.strength ?? 0));
  const frontlineIds =
    lens === 'frontline'
      ? new Set(
          regions
            .filter((region) =>
              neighborsOf(board, region.id).some((other) => {
                if (other.ownerId === region.ownerId) return false;
                if (!region.ownerId || !other.ownerId) return true;
                const stance = stanceBetween(board, region.ownerId, other.ownerId);
                return stance === 'war' || stance === 'hostile';
              }),
            )
            .map((r) => r.id),
        )
      : null;

  return (
    <div className={`map map--${size} map--lens-${lens}`} style={{ '--cols': columns, '--rows': rows } as CSSProperties}>
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
          const kind = inferSandboxRegionKind(region);
          const defense = sandboxRegionDefense(region);
          const stability = sandboxRegionStability(region);
          const commander = region.commanderId && world ? world.characters[region.commanderId] : undefined;
          const isSelected = region.id === selected;

          const classes = ['map__region', `map__region--${kind}`];
          if (region.x === minX || region.x === minX + columns - 1) classes.push('is-edge');
          if (!owner) classes.push('is-unclaimed');
          if (owner?.isPlayer) classes.push('is-player');
          if (isSelected) classes.push('is-selected');
          if (commander) classes.push('has-commander');
          if (stability < 38) classes.push('is-crisis');

          if (lens === 'military') classes.push('is-lens-military');
          if (lens === 'governance') {
            classes.push(
              stability >= 65 ? 'is-gov-good' : stability >= 38 ? 'is-gov-warn' : 'is-gov-crisis',
            );
          }
          if (frontlineIds) {
            classes.push(frontlineIds.has(region.id) ? 'is-frontline' : 'is-rear');
          }

          const heat = Math.min(1, Math.max(0, (region.strength ?? 0) / maxStrength));
          const tokenText =
            lens === 'governance'
              ? `${stability}`
              : region.strength !== null
                ? formatCompact(region.strength, uiTag)
                : kind === 'capital'
                  ? '★'
                  : '';

          const label =
            region.strength !== null
              ? t('world.sandbox.region.labelStrength', {
                  name: region.name,
                  owner: ownerName,
                  n: formatNumber(region.strength, uiTag),
                })
              : t('world.sandbox.region.label', { name: region.name, owner: ownerName });

          const tooltipParts = [
            `${region.name}（${t(`world.sandbox.kind.${kind}`)} · ${ownerName}）`,
            region.strength !== null ? `${t('world.sandbox.region.strength')} ${formatNumber(region.strength, uiTag)}` : '',
            `${t('world.sandbox.region.defense')} ${defense} · ${t('world.sandbox.region.stability')} ${stability}`,
            commander ? `${t('world.sandbox.region.commander')}: ${commander.name}` : '',
            region.status ?? '',
          ].filter(Boolean);

          return (
            <button
              key={region.id}
              type="button"
              className={classes.join(' ')}
              style={{
                left: `${(cx(region.x) / columns) * 100}%`,
                top: `${(cy(region.y) / rows) * 100}%`,
                '--heat': heat.toFixed(2),
                ...factionStyle(owner),
              } as CSSProperties}
              aria-pressed={isSelected}
              aria-label={label}
              title={tooltipParts.join(' | ')}
              onClick={() => onSelect(isSelected ? null : region.id)}
            >
              <span className="map__token" aria-hidden="true">
                {tokenText}
                {commander && <span className="map__commander-pip" />}
              </span>
              <span className="map__name" lang={lang} aria-hidden="true">
                {region.name}
              </span>
              {size === 'large' && (commander || region.status) && (
                <span className="map__sub" lang={lang} aria-hidden="true">
                  {commander ? commander.name : region.status}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Which colour is whose: the factions on the map, unclaimed land, front lines, and crisis zones. */
export function MapLegend({ board, lang }: { board: SandboxState; lang: string }) {
  const { t } = useTranslation();
  const regions = Object.values(board.regions);
  const holders = new Set(regions.map((r) => r.ownerId));
  const factions = sortedFactions(board).filter((f) => holders.has(f.id));
  const unclaimed = regions.some((r) => !r.ownerId || !board.factions[r.ownerId]);
  const front = bordersOf(board).some((b) => b.kind === 'front');
  const hasCrisis = regions.some((r) => sandboxRegionStability(r) < 38);
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
      {hasCrisis && (
        <li className="map-legend__item">
          <span className="map-legend__crisis" aria-hidden="true" />
          {t('world.sandbox.crisisLegend')}
        </li>
      )}
    </ul>
  );
}
