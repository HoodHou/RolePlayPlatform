import type { DomainFacility, WorldState } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';
import { languageTag, useLocale } from '../../i18n';
import { formatNumber, formatSigned } from '../../lib/text';
import { useUi } from '../../store/ui';
import { CharacterAvatar } from '../CharacterAvatar';
import { ModuleOpButtons } from './ModuleOpControls';

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
  const steward = facility.stewardId ? world.characters[facility.stewardId] : undefined;

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
        <ModuleOpButtons
          directive={{
            moduleId: 'domain',
            op: 'advisor_note',
            params: {
              intent: 'assign_steward',
              facility_id: facility.id,
              current_steward_id: facility.stewardId ?? null,
            },
            label: `${facility.name} · ${
              steward ? t('world.domain.ops.changeSteward') : t('world.domain.ops.assignSteward')
            }`,
            aiNote: steward
              ? `拟旨改派领地设施「${facility.name}」的驻守主理人（现任：${steward.name}）。请从我方符合专长与身份的在案臣属/弟子中择定合适人选接任，妥善交接差遣，并更新 record.domain.facilities 的 steward_id。`
              : `拟旨为领地设施「${facility.name}」委派驻守主理人。请从我方符合专长与身份的在案臣属/弟子中遴选合适人选主理，并写入 record.domain.facilities 的 steward_id。`,
          }}
          instantLabel={steward ? t('world.domain.ops.changeSteward') : t('world.domain.ops.assignSteward')}
          compact
        />
      </div>

      <div className="card__actions">
        {facility.status === 'operational' && facility.level < facility.maxLevel && (
          <ModuleOpButtons
            directive={{
              moduleId: 'domain',
              op: 'advisor_note',
              params: { intent: 'upgrade_facility', facility_id: facility.id },
              label: `${facility.name} · ${t('world.domain.ops.startUpgrade')}`,
              aiNote: `下令兴工扩建领地设施「${facility.name}」（当前 Lv.${facility.level}/${facility.maxLevel}）。请核验领地府库资源并扣除合理营造耗费，在 record.domain.facilities 中将其设为 status: "building"（或视工期调用 develop_domain 推进）。`,
            }}
            instantLabel={t('world.domain.ops.startUpgrade')}
            compact
          />
        )}
        {(facility.status === 'building' || facility.status === 'damaged') && (
          <ModuleOpButtons
            directive={{
              moduleId: 'domain',
              op: 'advisor_note',
              params: { intent: 'develop_domain', facility_id: facility.id },
              label: `${facility.name} · ${t('world.domain.ops.pushWorks')}`,
              aiNote: `督办领地设施「${facility.name}」营造修缮（当前工期 ${facility.progress}/${facility.segments}）。请调用 develop_domain 工具（facility_id: "${facility.id}"）结算本期工程进度与资源产出，并叙述营造实况。`,
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
