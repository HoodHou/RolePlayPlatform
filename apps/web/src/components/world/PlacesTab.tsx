import type { WorldState } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';
import { languageTag, useLocale } from '../../i18n';
import { formatList } from '../../lib/text';
import { npcsOf, sortedPlaces } from '../../lib/world';
import { Thumb } from './Thumb';

export function PlacesTab({ world, lang }: { world: WorldState; lang: string }) {
  const { t } = useTranslation();
  const uiTag = languageTag(useLocale());
  const places = sortedPlaces(world);
  if (places.length === 0) return <p className="tab-empty">{t('world.places.empty')}</p>;
  const npcs = npcsOf(world);

  return (
    <ul className="cards">
      {places.map((place) => {
        const current = place.id === world.scene.locationId;
        const routes = place.connections.flatMap((id) => {
          const name = world.locations[id]?.name;
          return name ? [name] : [];
        });
        const people = npcs.filter((c) => c.locationId === place.id).map((c) => c.name);
        return (
          <li key={place.id} className={current ? 'card is-current' : 'card'} aria-current={current ? 'location' : undefined}>
            {place.imageUrl && (
              <Thumb
                url={place.imageUrl}
                alt={t('world.pictureOf', { name: place.name })}
                caption={place.name}
                shape="landscape"
                size="large"
                lang={lang}
              />
            )}
            <div className="card__head">
              <h4 className="card__title" lang={lang}>
                {place.name}
              </h4>
              {current && <span className="tag tag--accent">{t('world.places.here')}</span>}
            </div>
            {place.description && (
              <p className="card__text" lang={lang}>
                {place.description}
              </p>
            )}
            {people.length > 0 && (
              <p className="card__meta">{t('world.places.people', { names: formatList(people, uiTag) })}</p>
            )}
            <p className="card__meta">
              {routes.length > 0
                ? t('world.places.leadsTo', { places: formatList(routes, uiTag) })
                : t('world.places.noRoutes')}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
