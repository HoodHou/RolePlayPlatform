import type { MarketShop, MarketState, WorldState } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';

function ShopCard({
  shop,
  currency,
  world,
  lang,
}: {
  shop: MarketShop;
  currency: string;
  world: WorldState;
  lang: string;
}) {
  const { t } = useTranslation();
  const location = shop.locationId ? world.locations[shop.locationId] : undefined;
  const keeper = shop.keeperId ? world.characters[shop.keeperId] : undefined;
  const wares = Object.values(shop.wares);
  const here = shop.locationId !== null && shop.locationId === world.scene.locationId;

  return (
    <li className={`card${here ? ' is-here' : ''}`}>
      <div className="card__head">
        <h4 className="card__title" lang={lang}>
          {shop.name}
        </h4>
        {here && <span className="tag">{t('world.here')}</span>}
      </div>
      {(location || keeper) && (
        <p className="card__meta" lang={lang}>
          {[keeper?.name, location?.name].filter(Boolean).join(' · ')}
        </p>
      )}
      {shop.description && (
        <p className="card__text" lang={lang}>
          {shop.description}
        </p>
      )}
      {wares.length === 0 ? (
        <p className="world-note">{t('world.market.emptyShop')}</p>
      ) : (
        <ul className="chips">
          {wares.map((ware) => (
            <li key={ware.id} className="chip" title={ware.description || undefined}>
              <span className="chip__name" lang={lang}>
                {ware.name}
              </span>
              <span className="chip__val">
                {ware.price} {currency}
                {ware.stock !== null ? ` (${t('world.market.stock', { count: ware.stock })})` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Read-only view of the market ledger: currency and shops with their wares and prices. */
export function MarketTab({ market, world, lang }: { market: MarketState; world: WorldState; lang: string }) {
  const { t } = useTranslation();
  const shops = Object.values(market.shops);

  return (
    <div className="market">
      <p className="world-note">
        {t('world.market.currency')}: <strong lang={lang}>{market.currency}</strong>
      </p>
      <ul className="cards">
        {shops.map((shop) => (
          <ShopCard key={shop.id} shop={shop} currency={market.currency} world={world} lang={lang} />
        ))}
      </ul>
    </div>
  );
}
