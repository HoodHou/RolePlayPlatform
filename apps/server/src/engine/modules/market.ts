import {
  type HaggleOutcome,
  type MarketShop,
  type MarketState,
  type MarketWare,
  type WorldEvent,
  type WorldState,
} from '@roleplay/shared';
import { z } from 'zod';
import { asParts, entryReader, id, invalidInput, toJsonSchema, type EntryError, type GameTool, type ToolContext } from '../toolKit';
import { setStat, upsertItem, WorldOpError } from '../world';
import type { GameModule } from './types';

/**
 * Market: currency, shops, wares, and a `trade` tool that settles buying,
 * selling, and haggling on the server while keeping the player's inventory and
 * coin stat in step. Merchants who speak for themselves in `talk` turns are
 * shown their own price list so they quote the real numbers.
 */

export const TRADE = 'trade';

const die = (sides: number, random: () => number) => Math.floor(random() * sides) + 1;

function ensureMarket(world: WorldState): MarketState {
  return (world.modules.market ??= {
    currency: 'Coin',
    currencyStat: null,
    shops: {},
  });
}

const COMMON_CURRENCY_STATS = ['coin', 'gold', 'silver', 'credits', 'money', 'wealth', '银两', '铜钱', '金币', '灵石', '信用点'];

/** Finds the stat on the player's sheet that holds their money, when one exists. */
function findPlayerCurrencyStat(world: WorldState, market: MarketState): { name: string; value: number } | null {
  const player = world.playerId ? world.characters[world.playerId] : undefined;
  if (!player) return null;

  if (market.currencyStat) {
    const stat = player.stats.find((s) => s.name === market.currencyStat);
    if (stat && typeof stat.value === 'number') return { name: stat.name, value: stat.value };
    return { name: market.currencyStat, value: 0 };
  }

  const byCurrency = player.stats.find(
    (s) => typeof s.value === 'number' && s.name.toLowerCase() === market.currency.toLowerCase(),
  );
  if (byCurrency && typeof byCurrency.value === 'number') return { name: byCurrency.name, value: byCurrency.value };

  const byCommon = player.stats.find(
    (s) => typeof s.value === 'number' && COMMON_CURRENCY_STATS.includes(s.name.toLowerCase()),
  );
  if (byCommon && typeof byCommon.value === 'number') return { name: byCommon.name, value: byCommon.value };

  return null;
}

export interface HaggleResult {
  rolls: [number, number];
  total: number;
  outcome: HaggleOutcome;
  unitPrice: number;
}

/**
 * Resolves a 2d6 haggle roll against a base unit price.
 *   10+ (or boxcars): `deal` — 20% in the player's favor.
 *   7..9:             `fair` — 10% in the player's favor.
 *   6 or less:        `refused` — price stands (or worsens by 10% on snake eyes).
 */
export function resolveHaggle(
  side: 'buy' | 'sell',
  basePrice: number,
  bonus: number,
  random: () => number,
): HaggleResult {
  const d1 = die(6, random);
  const d2 = die(6, random);
  const total = d1 + d2 + bonus;
  const boxcars = d1 === 6 && d2 === 6;
  const snakeEyes = d1 === 1 && d2 === 1;

  let outcome: HaggleOutcome;
  let factor = 1;
  if ( !snakeEyes && (boxcars || total >= 10)) {
    outcome = 'deal';
    factor = side === 'buy' ? 0.8 : 1.2;
  } else if (!snakeEyes && total >= 7) {
    outcome = 'fair';
    factor = side === 'buy' ? 0.9 : 1.1;
  } else {
    outcome = 'refused';
    factor = snakeEyes ? (side === 'buy' ? 1.1 : 0.9) : 1;
  }

  const unitPrice = basePrice === 0 ? 0 : Math.max(1, Math.round(basePrice * factor));
  return { rolls: [d1, d2], total, outcome, unitPrice };
}

// --- the trade tool ----------------------------------------------------------

const tradeInput = z.strictObject({
  side: z.enum(['buy', 'sell']).describe('Whether the player is buying from the shop or selling to it.'),
  shop_id: id.describe('Id of the shop in `world.modules.market.shops`.'),
  item_id: id.describe('For `buy`: id of the ware in the shop (becomes the item id in inventory). For `sell`: id of the item in the player\'s inventory.'),
  quantity: z.number().int().min(1).max(99).optional().describe('How many units change hands. Defaults to 1.'),
  unit_price: z
    .number()
    .int()
    .min(0)
    .max(999999)
    .optional()
    .describe('Override unit price before haggling. Required when selling an item the shop does not already list.'),
  haggle: z.boolean().optional().describe('True when the player bargains over the price: rolls 2d6 + `haggle_bonus`.'),
  haggle_bonus: z.number().int().min(-10).max(20).optional().describe('Modifier to the 2d6 haggle roll from a social stat or leverage.'),
});

const tradeTool: GameTool = {
  name: TRADE,
  silent: false,
  records: true,
  endsTurn: false,
  run(world: WorldState, raw: unknown, ctx: ToolContext) {
    const parsed = tradeInput.safeParse(raw);
    if (!parsed.success) return invalidInput(parsed.error, raw);
    const input = parsed.data;

    try {
      const market = world.modules.market;
      const shop = market?.shops[input.shop_id];
      if (!market || !shop) {
        throw new WorldOpError(`There is no shop with id "${input.shop_id}". Set it up in record.market first.`);
      }

      const quantity = input.quantity ?? 1;
      const events: WorldEvent[] = [];
      const wallet = findPlayerCurrencyStat(world, market);

      if (input.side === 'buy') {
        const ware = shop.wares[input.item_id];
        if (!ware) {
          throw new WorldOpError(`Shop "${shop.name}" has no ware with id "${input.item_id}".`);
        }
        if (ware.stock !== null && ware.stock < quantity) {
          throw new WorldOpError(
            `Shop "${shop.name}" only has ${ware.stock} of "${ware.name}" in stock (asked for ${quantity}).`,
          );
        }

        const basePrice = input.unit_price ?? ware.price;
        const haggled = input.haggle
          ? resolveHaggle('buy', basePrice, input.haggle_bonus ?? 0, ctx.random)
          : null;
        const unitPrice = haggled ? haggled.unitPrice : basePrice;
        const totalPrice = unitPrice * quantity;

        if (wallet && wallet.value < totalPrice) {
          throw new WorldOpError(
            `Not enough ${market.currency}: "${ware.name}" x${quantity} costs ${totalPrice}, but the player only has ${wallet.value}.`,
          );
        }

        let newBalance: number | null = null;
        if (wallet && world.playerId) {
          newBalance = wallet.value - totalPrice;
          events.push(...setStat(world, world.playerId, wallet.name, newBalance));
        }

        if (ware.stock !== null) {
          ware.stock -= quantity;
        }

        const existingItem = world.items[ware.id];
        const heldQuantity =
          existingItem && world.playerId && existingItem.ownerId === world.playerId ? existingItem.quantity : 0;
        events.push(
          ...upsertItem(world, {
            id: ware.id,
            name: ware.name,
            description: ware.description || existingItem?.description || '',
            quantity: heldQuantity + quantity,
            ownerId: world.playerId,
          }),
        );

        events.push({
          type: 'trade_settled',
          side: 'buy',
          shopId: shop.id,
          shopName: shop.name,
          itemId: ware.id,
          itemName: ware.name,
          quantity,
          unitPrice,
          totalPrice,
          currency: market.currency,
          balance: newBalance,
          haggled: haggled !== null,
          haggleRoll: haggled ? haggled.total : null,
          haggleOutcome: haggled ? haggled.outcome : null,
        });

        return {
          content: JSON.stringify({
            side: 'buy',
            shop: shop.name,
            item: ware.name,
            quantity,
            unit_price: unitPrice,
            total_price: totalPrice,
            currency: market.currency,
            balance: newBalance,
            stock_remaining: ware.stock,
            ...(haggled
              ? {
                  haggle: {
                    rolls: haggled.rolls,
                    total: haggled.total,
                    outcome: haggled.outcome,
                  },
                }
              : {}),
          }),
          isError: false,
          events,
        };
      }

      // side === 'sell'
      const item = world.items[input.item_id];
      if (!item || !world.playerId || item.ownerId !== world.playerId || item.quantity < quantity) {
        const held = item && world.playerId && item.ownerId === world.playerId ? item.quantity : 0;
        throw new WorldOpError(
          `The player does not hold ${quantity} of "${input.item_id}" to sell (currently holding ${held}).`,
        );
      }

      const listedWare = shop.wares[input.item_id];
      const basePrice =
        input.unit_price ?? (listedWare ? Math.max(1, Math.floor(listedWare.price * 0.5)) : undefined);
      if (basePrice === undefined) {
        throw new WorldOpError(
          `Item "${item.name}" is not on "${shop.name}"'s price list. Pass "unit_price" to name what the merchant offers for it.`,
        );
      }

      const haggled = input.haggle
        ? resolveHaggle('sell', basePrice, input.haggle_bonus ?? 0, ctx.random)
        : null;
      const unitPrice = haggled ? haggled.unitPrice : basePrice;
      const totalPrice = unitPrice * quantity;

      let newBalance: number | null = null;
      if (wallet && world.playerId) {
        newBalance = wallet.value + totalPrice;
        events.push(...setStat(world, world.playerId, wallet.name, newBalance));
      }

      events.push(
        ...upsertItem(world, {
          id: item.id,
          quantity: item.quantity - quantity,
        }),
      );

      if (listedWare && listedWare.stock !== null) {
        listedWare.stock += quantity;
      }

      events.push({
        type: 'trade_settled',
        side: 'sell',
        shopId: shop.id,
        shopName: shop.name,
        itemId: item.id,
        itemName: item.name,
        quantity,
        unitPrice,
        totalPrice,
        currency: market.currency,
        balance: newBalance,
        haggled: haggled !== null,
        haggleRoll: haggled ? haggled.total : null,
        haggleOutcome: haggled ? haggled.outcome : null,
      });

      return {
        content: JSON.stringify({
          side: 'sell',
          shop: shop.name,
          item: item.name,
          quantity,
          unit_price: unitPrice,
          total_price: totalPrice,
          currency: market.currency,
          balance: newBalance,
          ...(haggled
            ? {
                haggle: {
                  rolls: haggled.rolls,
                  total: haggled.total,
                  outcome: haggled.outcome,
                },
              }
            : {}),
        }),
        isError: false,
        events,
      };
    } catch (err) {
      if (err instanceof WorldOpError) return { content: err.message, isError: true, events: [] };
      throw err;
    }
  },
};

// --- record.market: setting up currency, shops, and wares --------------------

const wareSchema = z.strictObject({
  id,
  name: z.string().optional().describe('Display name of the ware. Required when adding a new ware.'),
  description: z.string().optional().describe('One-line description or effect.'),
  price: z.number().int().min(0).max(999999).optional().describe('Unit price in the world\'s currency. Required when adding.'),
  stock: z.number().int().min(0).max(9999).nullable().optional().describe('Units available, or null when the shop does not run out.'),
  remove: z.boolean().optional().describe('True to take this ware off the shelf.'),
});

const shopSchema = z.strictObject({
  id,
  name: z.string().optional().describe('Shop or merchant stall name. Required when creating.'),
  description: z.string().optional().describe('What kind of shop this is and its atmosphere.'),
  location_id: id.nullable().optional().describe('Where the shop stands, or null for a travelling merchant.'),
  keeper_id: id.nullable().optional().describe('Character id of the merchant who runs it, when they are in the cast.'),
  wares: z.array(wareSchema).max(30).optional().describe('Wares to stock, reprice, or remove.'),
  remove: z.boolean().optional().describe('True to close and remove this shop.'),
});

const marketSection = z
  .strictObject({
    currency: z.string().min(1).max(32).optional().describe('Name of the currency used in this world ("Silver", "Crowns", "银两").'),
    currency_stat: z
      .string()
      .min(1)
      .max(32)
      .nullable()
      .optional()
      .describe('Name of the stat on the player\'s sheet that tracks their money, so `trade` deducts and adds to it directly.'),
    shops: z.array(shopSchema).max(12).optional().describe('Shops and stalls to open, restock, or close.'),
  })
  .describe('Market ledger: currency settings and shops with their wares and prices.');

function upsertWare(shop: MarketShop, entry: z.infer<typeof wareSchema>): void {
  const existing = shop.wares[entry.id];
  if (entry.remove) {
    if (!existing) throw new WorldOpError(`Shop "${shop.id}" has no ware "${entry.id}".`);
    delete shop.wares[entry.id];
    return;
  }

  const name = entry.name?.trim();
  if (!existing && !name) {
    throw new WorldOpError(`Ware "${entry.id}" in shop "${shop.id}" does not exist yet. Include "name" to add it.`);
  }
  if (!existing && entry.price === undefined) {
    throw new WorldOpError(`Ware "${entry.id}" in shop "${shop.id}" needs a "price".`);
  }

  const ware: MarketWare = existing ?? {
    id: entry.id,
    name: name ?? '',
    description: '',
    price: entry.price ?? 0,
    stock: null,
  };
  if (existing && name) ware.name = name;
  if (entry.description !== undefined) ware.description = entry.description;
  if (entry.price !== undefined) ware.price = entry.price;
  if (entry.stock !== undefined) ware.stock = entry.stock;

  shop.wares[ware.id] = ware;
}

function applyMarket(world: WorldState, section: unknown, errors: EntryError[]): WorldEvent[] {
  const parts = asParts(section, 'market', errors);
  if (!parts) return [];

  const events: WorldEvent[] = [];
  const reader = entryReader(parts, 'market.', errors, events);
  reader.rejectUnknown(['currency', 'currency_stat', 'shops'], 'market field');

  reader.one('currency', z.string().min(1).max(32), (currency) => {
    ensureMarket(world).currency = currency.trim();
    return [];
  });

  reader.one('currency_stat', z.string().min(1).max(32).nullable(), (stat) => {
    ensureMarket(world).currencyStat = stat ? stat.trim() : null;
    return [];
  });

  reader.each('shops', shopSchema, (entry) => {
    const market = ensureMarket(world);
    const existing = market.shops[entry.id];

    if (entry.remove) {
      if (!existing) throw new WorldOpError(`There is no shop with id "${entry.id}".`);
      delete market.shops[entry.id];
      return [];
    }

    if (entry.location_id && !world.locations[entry.location_id]) {
      throw new WorldOpError(`Location "${entry.location_id}" does not exist.`);
    }
    if (entry.keeper_id && !world.characters[entry.keeper_id]) {
      throw new WorldOpError(`Character "${entry.keeper_id}" does not exist.`);
    }

    const name = entry.name?.trim();
    if (!existing && !name) {
      throw new WorldOpError(`Shop "${entry.id}" does not exist yet. Include "name" to open it.`);
    }

    const shop: MarketShop = existing ?? {
      id: entry.id,
      name: name ?? '',
      description: '',
      locationId: world.scene.locationId,
      keeperId: null,
      wares: {},
    };

    if (existing && name) shop.name = name;
    if (entry.description !== undefined) shop.description = entry.description;
    if (entry.location_id !== undefined) shop.locationId = entry.location_id;
    if (entry.keeper_id !== undefined) shop.keeperId = entry.keeper_id;

    if (entry.wares) {
      entry.wares.forEach((wareEntry, index) => {
        try {
          upsertWare(shop, wareEntry);
        } catch (err) {
          if (!(err instanceof WorldOpError)) throw err;
          errors.push({ at: `market.shops[${entry.id}].wares[${index}]`, problem: err.message });
        }
      });
    }

    market.shops[shop.id] = shop;
    return existing ? [] : [{ type: 'shop_opened', id: shop.id, name: shop.name }];
  });

  return events;
}

/** What a merchant or local character knows of the shops where they stand. */
function shownMarket(world: WorldState, characterId: string): unknown {
  const market = world.modules.market;
  if (!market) return undefined;
  const character = world.characters[characterId];
  const shops = Object.values(market.shops).filter(
    (shop) => shop.keeperId === characterId || (character?.locationId && shop.locationId === character.locationId),
  );
  if (shops.length === 0) return undefined;

  return {
    currency: market.currency,
    shops: shops.map((shop) => ({
      name: shop.name,
      you_keep_it: shop.keeperId === characterId,
      wares: Object.values(shop.wares).map((ware) => ({
        name: ware.name,
        price: ware.price,
        ...(ware.stock !== null ? { stock: ware.stock } : {}),
      })),
    })),
  };
}

const en = `## Market

You have a market ledger and the trade tool for stories where coin, supplies, and merchants matter.

Set up the world's currency and open shops under record.market. Give the player a matching numeric stat on their sheet (such as "Coin" or "Silver") and name it in currency_stat so the server keeps their purse in step with every purchase and sale. Stock each shop with wares, their prices, and optional stock counts.

When the player buys or sells an item, call trade before narrating the exchange. Pass haggle: true with a haggle_bonus when the player bargains over the price: the server rolls 2d6 (10+ is a 20% deal, 7-9 is a 10% fair cut, 6 or less is refused), updates the player's coin stat, adds or removes the item in their inventory, adjusts the shop's stock, and tells you the exact total and remaining balance.`;

const zh = `## 集市与商贸

你有集市账本与 trade 工具，用于钱银、物资与行商买卖至关重要的故事。

在 record.market 中设定世界的货币名称并开设商铺。在玩家的角色卡上设置对应的数值属性（如“银两”或“金币”）并在 currency_stat 中指明，这样服务端会在每次买卖时自动同步玩家的钱袋。为每家商铺陈列商品（wares）、单价与可选的库存数量。

当玩家买入或卖出物品时，先调用 trade 再叙述交易过程。若玩家讨价还价，传入 haggle: true 与 haggle_bonus：服务端会投掷 2d6（10+ 达成八折/溢价两成的划算交易，7-9 为九折/溢价一成，6 及以下被拒），自动增减玩家的钱银属性、更新物品栏与商铺库存，并将成交总价与余额返回给你。`;

export const marketModule: GameModule = {
  id: 'market',
  keptWhenUnused: true,
  hasPanel: true,
  tools: [
    {
      tool: tradeTool,
      spec: {
        name: TRADE,
        description:
          'Settle a purchase or sale between the player and a shop, with optional 2d6 haggling. Updates the player\'s coin stat, inventory, and shop stock automatically. Call before narrating the transaction.',
        inputSchema: toJsonSchema(tradeInput),
      },
    },
  ],
  record: { schema: marketSection, apply: applyMarket },
  guide: { en, zh },
  shownToCharacter: { tag: 'market', of: shownMarket },
};
