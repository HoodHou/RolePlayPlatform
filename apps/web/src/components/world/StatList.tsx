import type { Stat } from '@roleplay/shared';

type GaugeStat = Stat & { value: number; max: number };

function isGauge(stat: Stat): stat is GaugeStat {
  return typeof stat.value === 'number' && typeof stat.max === 'number' && stat.max > 0;
}

function Gauge({ stat }: { stat: GaugeStat }) {
  const percent = Math.min(100, Math.max(0, (stat.value / stat.max) * 100));
  return (
    <div className={percent <= 25 ? 'gauge is-low' : 'gauge'}>
      <div className="gauge__label">
        <span className="gauge__name">{stat.name}</span>
        <span className="gauge__value">
          {stat.value} / {stat.max}
        </span>
      </div>
      <div
        className="gauge__track"
        role="meter"
        aria-label={stat.name}
        aria-valuemin={0}
        aria-valuemax={stat.max}
        aria-valuenow={stat.value}
      >
        <div className="gauge__fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/** Numeric stats with a max render as gauges; everything else as label / value. */
export function StatList({ stats, label, lang }: { stats: Stat[]; label: string; lang: string }) {
  if (stats.length === 0) return null;
  const gauges = stats.filter(isGauge);
  const plain = stats.filter((stat) => !isGauge(stat));

  return (
    <div className="stats" role="group" aria-label={label} lang={lang}>
      {gauges.map((stat, index) => (
        <Gauge key={`${index}:${stat.name}`} stat={stat} />
      ))}
      {plain.length > 0 && (
        <dl className="stats__plain">
          {plain.map((stat, index) => (
            <div key={`${index}:${stat.name}`} className="stats__row">
              <dt>{stat.name}</dt>
              <dd>{stat.max !== undefined ? `${stat.value} / ${stat.max}` : stat.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
