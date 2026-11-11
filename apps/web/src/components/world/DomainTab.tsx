import type { DomainFacility, WorldState } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';
import { languageTag, useLocale } from '../../i18n';
import { formatNumber, formatSigned } from '../../lib/text';
import { npcsOf } from '../../lib/world';
import { useGame } from '../../store/game';
import { useUi } from '../../store/ui';
import { CharacterAvatar } from '../CharacterAvatar';
import { ModuleOpButtons, useCanOperateModule } from './ModuleOpControls';

export function hasDomainContent(world: WorldState): boolean {
  const domain = world.modules?.domain;
  if (!domain) return false;
  return Boolean(
    domain.name || domain.resources.length > 0 || Object.keys(domain.facilities).length > 0,
  );
}

function FacilityCard({
  facility,
  world,
  lang,
}: {
  facility: DomainFacility;
  world: WorldState;
  lang: string;
}) {
  const { t } = useTranslation();
  const openDossier = useUi((s) => s.openDossier);
  const executeDirective = useGame((s) => s.executeDirective);
  const canOperate = useCanOperateModule();
  const steward = facility.stewardId ? world.characters[facility.stewardId] : undefined;
  const npcs = npcsOf(world);

  const statusTag =
    facility.status === 'operational'
      ? 'tag tag--completed'
      : facility.status === 'damaged'
        ? 'tag tag--failed'
        : 'tag tag--accent';

  const showProgress = facility.status !== 'operational' || facility.progress > 0;
  const pct = Math.max(0, Math.min(100, (facility.progress / Math.max(1, facility.segments)) * 100));

  return (
    <li className={facility.status === 'building' ? 'card is-present' : 'card'}>
      <div className="card__head">
        <h4 className="card__title" lang={lang}>
          {facility.name}
        </h4>
        <div className="card__head-tags">
          <span className="tag">
            {t('world.domain.level', { level: facility.level, max: facility.maxLevel })}
          </span>
          <span className={statusTag}>{t(`world.domain.status.${facility.status}`)}</span>
        </div>
      </div>

      {facility.category && (
        <p className="card__subtitle" lang={lang}>
          {facility.category}
        </p>
      )}

      {showProgress && (
        <div className="mini-meter">
          <div className="mini-meter__head">
            <span className="mini-meter__label">{t('world.domain.construction')}</span>
            <span className="mini-meter__value">
              {facility.progress} / {facility.segments}
            </span>
          </div>
          <div className="mini-meter__track" aria-hidden="true">
            <div className="mini-meter__fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {facility.output && (
        <p className="card__meta" lang={lang}>
          {t('world.domain.output')}: <strong>{facility.output}</strong>
        </p>
      )}

      {facility.description && (
        <p className="card__text" lang={lang}>
          {facility.description}
        </p>
      )}

      <div className="domain-steward">
        <span className="card__label">{t('world.domain.steward')}</span>
        {steward ? (
          <button
            type="button"
            className="steward-chip"
            lang={lang}
            onClick={() => openDossier(steward.id)}
          >
            <CharacterAvatar name={steward.name} imageUrl={steward.imageUrl} size="small" />
            <span>{steward.name}</span>
          </button>
        ) : (
          <span className="muted">{t('world.domain.unassigned')}</span>
        )}
        {npcs.length > 0 && (
          <select
            className="op-select op-select--inline"
            aria-label={t('world.domain.ops.assignSteward')}
            value={facility.stewardId ?? ''}
            disabled={!canOperate}
            onChange={(e) => {
              const nextId = e.target.value || null;
              void executeDirective({
                moduleId: 'domain',
                op: 'assign_steward',
                params: { facility_id: facility.id, steward_id: nextId },
                label: `${facility.name} · ${t('world.domain.ops.assignSteward')}`,
              });
            }}
          >
            <option value="">{t('world.domain.unassigned')}</option>
            {npcs.map((npc) => (
              <option key={npc.id} value={npc.id}>
                {npc.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="card__actions">
        {facility.status === 'operational' && facility.level < facility.maxLevel && (
          <ModuleOpButtons
            directive={{
              moduleId: 'domain',
              op: 'set_facility_status',
              params: { facility_id: facility.id, status: 'building' },
              label: `${facility.name} · ${t('world.domain.ops.startUpgrade')}`,
            }}
            instantLabel={t('world.domain.ops.startUpgrade')}
            compact
          />
        )}
        {(facility.status === 'building' || facility.status === 'damaged') && (
          <ModuleOpButtons
            directive={{
              moduleId: 'domain',
              op: 'develop_domain',
              params: { facility_id: facility.id },
              label: `${facility.name} · ${t('world.domain.ops.pushWorks')}`,
            }}
            instantLabel={t('world.domain.ops.pushWorks')}
            compact
          />
        )}
      </div>
    </li>
  );
}

export function DomainTab({ world, lang }: { world: WorldState; lang: string }) {
  const { t } = useTranslation();
  const uiTag = languageTag(useLocale());
  const state = world.modules?.domain;
  if (!state) return null;

  const facilities = Object.values(state.facilities);
  const locationName = state.locationId ? world.locations[state.locationId]?.name : undefined;

  return (
    <div className="module-tab">
      <header className="regime-banner">
        <div className="regime-banner__main">
          {state.name && (
            <h3 className="regime-banner__title" lang={lang}>
              {state.name}
            </h3>
          )}
          {state.tier && (
            <span className="tag tag--accent" lang={lang}>
              {state.tier}
            </span>
          )}
          <div className="regime-banner__cta">
            <ModuleOpButtons
              directive={{
                moduleId: 'domain',
                op: 'develop_domain',
                params: {},
                label: t('world.domain.ops.advanceCycle'),
              }}
              instantLabel={t('world.domain.ops.advanceCycle')}
              compact
            />
          </div>
        </div>
        {(locationName || state.cycles > 0) && (
          <p className="regime-banner__meta">
            {locationName && <span lang={lang}>{locationName}</span>}
            {locationName && state.cycles > 0 && ' · '}
            {state.cycles > 0 && t('world.domain.cycles', { count: state.cycles })}
          </p>
        )}
      </header>

      {state.resources.length > 0 && (
        <section className="world-section">
          <h3 className="eyebrow">{t('world.domain.resourcesTitle')}</h3>
          <div className="metric-grid">
            {state.resources.map((r) => (
              <div key={r.id} className="metric-tile">
                <div className="metric-tile__head">
                  <span className="metric-tile__name" lang={lang}>
                    {r.name}
                  </span>
                  {r.perCycle !== 0 && (
                    <span
                      className={
                        r.perCycle > 0 ? 'metric-tile__delta is-up' : 'metric-tile__delta is-down'
                      }
                    >
                      {formatSigned(r.perCycle, uiTag)}/{t('world.domain.cycleUnit')}
                    </span>
                  )}
                </div>
                <div className="metric-tile__value">{formatNumber(r.amount, uiTag)}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {facilities.length > 0 ? (
        <section className="world-section">
          <h3 className="eyebrow">{t('world.domain.facilitiesTitle')}</h3>
          <ul className="cards">
            {facilities.map((f) => (
              <FacilityCard key={f.id} facility={f} world={world} lang={lang} />
            ))}
          </ul>
        </section>
      ) : (
        <p className="tab-empty">{t('world.domain.emptyFacilities')}</p>
      )}
    </div>
  );
}
