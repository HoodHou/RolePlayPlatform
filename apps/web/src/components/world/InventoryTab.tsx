import type { WorldState } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';
import { inventoryOf } from '../../lib/world';
import { Thumb } from './Thumb';

export function InventoryTab({ world, lang }: { world: WorldState; lang: string }) {
  const { t } = useTranslation();
  if (!world.playerId) return <p className="tab-empty">{t('world.inventory.noPlayer')}</p>;
  const items = inventoryOf(world);
  if (items.length === 0) return <p className="tab-empty">{t('world.inventory.empty')}</p>;

  return (
    <ul className="cards">
      {items.map((item) => (
        <li key={item.id} className="card card--compact">
          <div className="with-media">
            {item.imageUrl && (
              <Thumb
                url={item.imageUrl}
                alt={t('world.pictureOf', { name: item.name })}
                caption={item.name}
                shape="square"
                lang={lang}
              />
            )}
            <div className="with-media__main">
              <div className="card__head">
                <h4 className="card__title" lang={lang}>
                  {item.name}
                </h4>
                {item.quantity !== 1 && (
                  <span className="quantity">{t('world.inventory.quantity', { n: item.quantity })}</span>
                )}
              </div>
              {item.description && (
                <p className="card__text" lang={lang}>
                  {item.description}
                </p>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
