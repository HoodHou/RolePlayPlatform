import type { TravelRoute, WorldState } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';
import { useUi } from '../../store/ui';
import { SecretsSwitch } from './SecretsSwitch';

export function visibleRoutes(world: WorldState, showSecrets: boolean): TravelRoute[] {
  const state = world.modules?.travel;
  if (!state) return [];
  return Object.values(state.routes).filter((route) => showSecrets || route.discovered);
}

function RouteCard({ route, world, lang }: { route: TravelRoute; world: WorldState; lang: string }) {
  const { t } = useTranslation();
  const fromName = world.locations[route.fromId]?.name ?? route.fromId;
  const toName = world.locations[route.toId]?.name ?? route.toId;
  const touchesCurrent =
    world.scene.locationId === route.fromId || world.scene.locationId === route.toId;

  return (
    <li className={`card${touchesCurrent ? ' is-here' : ''}${!route.discovered ? ' is-secret' : ''}`}>
      <div className="card__head">
        <h4 className="card__title" lang={lang}>
          {route.name}
        </h4>
        <span className="tag">{t(`world.travel.hazard.${route.hazard}`)}</span>
        {route.blocked && <span className="tag tag--secret">{t('world.travel.blocked')}</span>}
        {!route.discovered && <span className="tag tag--secret">{t('world.clocks.secret')}</span>}
      </div>
      <p className="card__meta" lang={lang}>
        {fromName} ↔ {toName} · {t('world.travel.hours', { count: route.hours })}
        {route.terrain ? ` · ${route.terrain}` : ''}
      </p>
      {route.description && (
        <p className="card__text" lang={lang}>
          {route.description}
        </p>
      )}
    </li>
  );
}

/** Read-only view of the travel route map: known routes, travel hours, and hazard levels. */
export function TravelTab({ world, lang }: { world: WorldState; lang: string }) {
  const { t } = useTranslation();
  const showSecrets = useUi((s) => s.showSecrets);
  const state = world.modules?.travel;
  if (!state) return null;
  const routes = visibleRoutes(world, showSecrets);

  return (
    <div className="travel">
      <SecretsSwitch warning={t('world.travel.secretsWarning')} />
      {state.hoursTravelled > 0 && (
        <p className="world-note">{t('world.travel.totalTravelled', { hours: state.hoursTravelled })}</p>
      )}
      <ul className="cards">
        {routes.map((route) => (
          <RouteCard key={route.id} route={route} world={world} lang={lang} />
        ))}
      </ul>
    </div>
  );
}
