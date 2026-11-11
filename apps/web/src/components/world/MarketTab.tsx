import type { MarketShop, MarketState, WorldState } from '@roleplay/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { languageTag, useLocale } from '../../i18n';
import { formatNumber } from '../../lib/text';
import { inventoryOf } from '../../lib/world';
import { Icon } from '../Icon';
import { ModuleOpButtons } from './ModuleOpControls';

const COMMON_CURRENCY_STATS = [
  'gold',
  'silver',
  'coin',
  'coins',
  'credits',
  'money',
  'wealth',
  '银两',
  '铜钱',
  '金币',
  '灵石',
  '钱银',
];

function playerBalanceOf(world: WorldState, market: MarketState): number | null {
  const player = world.playerId ? world.characters[world.playerId] : undefined;
  if (!player) return null;
  const currencyStat = market.currencyStat;
  if (currencyStat) {
    const exact = player.stats.find(
      (s) => typeof s.value === 'number' && s.name.toLowerCase() === currencyStat.toLowerCase(),
    );
    if (exact && typeof exact.value === 'number') return exact.value;
  }
  const byCurrency = player.stats.find(
    (s) => typeof s.value === 'number' && s.name.toLowerCase() === market.currency.toLowerCase(),
  );
  if (byCurrency && typeof byCurrency.value === 'number') return byCurrency.value;
  const byCommon = player.stats.find(
    (s) => typeof s.value === 'number' && COMMON_CURRENCY_STATS.includes(s.name.toLowerCase()),
  );
  return byCommon && typeof byCommon.value === 'number' ? byCommon.value : null;
}

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
  const canTradeHere = shop.locationId === null || here;

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
        <ul className="ware-list">
          {wares.map((ware) => {
            const inStock = ware.stock === null || ware.stock > 0;
            return (
              <li key={ware.id} className="ware-row" title={ware.description || undefined}>
                <div className="ware-row__info">
                  <span className="ware-row__name" lang={lang}>
                    {ware.name}
                  </span>
                  <span className="ware-row__val">
                    {ware.price} {currency}
                    {ware.stock !== null ? ` (${t('world.market.stock', { count: ware.stock })})` : ''}
                  </span>
                </div>
                {inStock && canTradeHere && (
                  <div className="ware-row__ops">
                    <ModuleOpButtons
                      directive={{
                        moduleId: 'market',
                        op: 'advisor_note',
                        params: { intent: 'buy', shop_id: shop.id, item_id: ware.id, quantity: 1 },
                        label: `${t('world.market.ops.buy')} · ${ware.name}`,
                        aiNote: `在「${shop.name}」按标价（${ware.price} ${currency}）购买 1 件「${ware.name}」。请调用 trade 工具（side: "buy", shop_id: "${shop.id}", item_id: "${ware.id}", quantity: 1）结算钱银与库存，并演绎交易细节。`,
                      }}
                      instantLabel={t('world.market.ops.buy')}
                      compact
                    />
                    <ModuleOpButtons
                      directive={{
                        moduleId: 'market',
                        op: 'advisor_note',
                        params: { intent: 'haggle', shop_id: shop.id, item_id: ware.id, quantity: 1 },
                        label: `${t('world.market.ops.haggle')} · ${ware.name}`,
                        aiNote: `在「${shop.name}」与掌柜讨价还价购买 1 件「${ware.name}」（标价 ${ware.price} ${currency}）。请调用 trade 工具（side: "buy", shop_id: "${shop.id}", item_id: "${ware.id}", quantity: 1, haggle: true）投骰裁定折扣并演绎议价经过。`,
                      }}
                      instantLabel={t('world.market.ops.haggle')}
                      compact
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

/** Interactive view of the market ledger: currency, balance, shops, and direct buy/haggle/sell operations. */
export function MarketTab({ market, world, lang }: { market: MarketState; world: WorldState; lang: string }) {
  const { t } = useTranslation();
  const uiTag = languageTag(useLocale());
  const [sellOpen, setSellOpen] = useState(false);

  const shops = Object.values(market.shops);
  const localShop = shops.find((s) => s.locationId === null || s.locationId === world.scene.locationId);
  const balance = playerBalanceOf(world, market);
  const items = inventoryOf(world);

  return (
    <div className="market">
      <div className="op-bar op-bar--spread">
        <p className="world-note">
          {t('world.market.currency')}: <strong lang={lang}>{market.currency}</strong>
        </p>
        {balance !== null && (
          <span className="tag tag--accent" lang={lang}>
            {t('world.market.ops.yourBalance', {
              amount: formatNumber(balance, uiTag),
              currency: market.currency,
            })}
          </span>
        )}
      </div>

      <ul className="cards">
        {shops.map((shop) => (
          <ShopCard key={shop.id} shop={shop} currency={market.currency} world={world} lang={lang} />
        ))}
      </ul>

      {localShop && items.length > 0 && (
        <section className="world-section">
          <button
            type="button"
            className="disclosure"
            aria-expanded={sellOpen}
            onClick={() => setSellOpen((v) => !v)}
          >
            {t('world.market.ops.sellSection')} ({items.length})
            <Icon name="chevron" size={14} className="disclosure__chevron" />
          </button>
          {sellOpen && (
            <ul className="ware-list">
              {items.map((item) => {
                const listed = localShop.wares[item.id];
                const unitPrice = listed ? Math.max(1, Math.round(listed.price * 0.6)) : 5;
                return (
                  <li key={item.id} className="ware-row">
                    <div className="ware-row__info">
                      <span className="ware-row__name" lang={lang}>
                        {item.name} ×{item.quantity}
                      </span>
                      <span className="ware-row__val">
                        {unitPrice} {market.currency}
                      </span>
                    </div>
                    <div className="ware-row__ops">
                      <ModuleOpButtons
                        directive={{
                          moduleId: 'market',
                          op: 'advisor_note',
                          params: {
                            intent: 'sell',
                            shop_id: localShop.id,
                            item_id: item.id,
                            quantity: 1,
                            unit_price: unitPrice,
                          },
                          label: `${t('world.market.ops.sell')} · ${item.name}`,
                          aiNote: `在「${localShop.name}」变卖随身物品「${item.name}」×1（估价约 ${unitPrice} ${market.currency}）。请核验该物是否可售并调用 trade 工具（side: "sell", shop_id: "${localShop.id}", item_id: "${item.id}", quantity: 1, unit_price: ${unitPrice}）完成交割。`,
                        }}
                        instantLabel={t('world.market.ops.sell')}
                        compact
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
