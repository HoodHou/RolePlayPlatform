import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  createEmptyWorld,
  MODULE_IDS,
  reputationTier,
  type ModuleLibraryResponse,
  type PluginManifest,
  type PublicSettings,
  type Session,
  type WorldEvent,
  type WorldState,
} from '@roleplay/shared';
import { createApp } from '../../app';
import { MockProvider } from '../../llm/mock';
import { ImageStore } from '../../store/imageStore';
import { SessionStore } from '../../store/sessionStore';
import { SettingsStore } from '../../store/settingsStore';
import { buildActorInit } from '../actor';
import { getToolbox, type ToolContext } from '../tools';
import { setScene, upsertCharacter, upsertItem, upsertLocation } from '../world';
import { clearPlugins, PluginStore } from './index';
import { resolveHaggle } from './market';
import { resolveJourney } from './travel';

/** A random source that makes dice of `sides` sides come up with these faces, in order (the last one repeats). */
function faces(sides: number, ...values: number[]): () => number {
  let next = 0;
  return () => ((values[Math.min(next++, values.length - 1)] ?? 1) - 0.5) / sides;
}

const everything = getToolbox({ illustrations: false, modules: MODULE_IDS });

function run(name: string, world: WorldState, input: unknown, random: () => number = faces(100, 50)) {
  const tool = everything.get(name);
  assert.ok(tool, name);
  const ctx: ToolContext = { random, narrate: () => {} };
  const outcome = tool.run(world, input, ctx);
  let report: unknown = outcome.content;
  try {
    report = JSON.parse(outcome.content);
  } catch {
    // Plain-text error messages stay strings.
  }
  return { ...outcome, report: report as Record<string, unknown> };
}

function worldWithTown(): WorldState {
  const world = createEmptyWorld();
  upsertLocation(world, { id: 'loc_square', name: 'Market Square' });
  upsertLocation(world, { id: 'loc_abbey', name: 'High Abbey' });
  setScene(world, { locationId: 'loc_square' });
  upsertCharacter(world, {
    id: 'pc',
    name: 'Lin',
    isPlayer: true,
    stats: [
      { name: 'Silver', value: 100 },
      { name: 'Charm', value: 2 },
    ],
  });
  upsertCharacter(world, {
    id: 'npc_smith',
    name: 'Master Oakhart',
    role: 'Blacksmith',
    locationId: 'loc_square',
  });
  world.turn = 2;
  return world;
}

function makeSession(world: WorldState): Session {
  const now = new Date().toISOString();
  return {
    id: 'sess-1',
    createdAt: now,
    updatedAt: now,
    language: 'en',
    seed: { premise: '', playerName: 'Lin', playerConcept: '' },
    modules: [...MODULE_IDS],
    modulesAuto: false,
    world,
    messages: [],
  };
}

// --- market ------------------------------------------------------------------

test('market: opens shops, settles buying and selling with haggling, and shows merchants their wares', () => {
  const world = worldWithTown();

  const opened = run('record', world, {
    market: {
      currency: 'Silver',
      currency_stat: 'Silver',
      shops: [
        {
          id: 'shop_forge',
          name: 'Oakhart Forge',
          description: 'Anvil sparks and oiled steel.',
          location_id: 'loc_square',
          keeper_id: 'npc_smith',
          wares: [
            { id: 'item_blade', name: ' Ash-iron Blade', description: 'Balanced short sword.', price: 50, stock: 2 },
            { id: 'item_torch', name: 'Pitch Torch', price: 5, stock: null },
          ],
        },
      ],
    },
    suggestions: ['Browse'],
  });
  assert.equal(opened.isError, false);
  assert.deepEqual(opened.events, [{ type: 'shop_opened', id: 'shop_forge', name: 'Oakhart Forge' }]);

  // Haggle rules: 10+ is a 20% deal, 7-9 is a 10% fair cut, <=6 is refused (snake eyes worsens by 10%).
  assert.equal(resolveHaggle('buy', 50, 0, faces(6, 5, 5)).outcome, 'deal');
  assert.equal(resolveHaggle('buy', 50, 0, faces(6, 5, 5)).unitPrice, 40);
  assert.equal(resolveHaggle('buy', 50, 0, faces(6, 4, 4)).outcome, 'fair');
  assert.equal(resolveHaggle('buy', 50, 0, faces(6, 4, 4)).unitPrice, 45);
  assert.equal(resolveHaggle('buy', 50, 0, faces(6, 1, 1)).unitPrice, 55);

  // Buy 1 Ash-iron Blade with a successful 2d6 haggle (5 + 5 + 2 = 12 -> deal, 40 Silver).
  const bought = run(
    'trade',
    world,
    { side: 'buy', shop_id: 'shop_forge', item_id: 'item_blade', quantity: 1, haggle: true, haggle_bonus: 2 },
    faces(6, 5, 5),
  );
  assert.equal(bought.isError, false);
  assert.equal(bought.report.total_price, 40);
  assert.equal(bought.report.balance, 60);
  assert.equal(world.characters.pc?.stats.find((s) => s.name === 'Silver')?.value, 60);
  assert.equal(world.items.item_blade?.quantity, 1);
  assert.equal(world.modules.market?.shops.shop_forge?.wares.item_blade?.stock, 1);

  // Buying more than remaining stock or more than balance is refused cleanly.
  assert.equal(run('trade', world, { side: 'buy', shop_id: 'shop_forge', item_id: 'item_blade', quantity: 3 }).isError, true);
  assert.equal(run('trade', world, { side: 'buy', shop_id: 'shop_forge', item_id: 'item_blade', quantity: 1, unit_price: 999 }).isError, true);

  // Sell the blade back without haggling (half of listed 50 = 25 Silver).
  const sold = run('trade', world, { side: 'sell', shop_id: 'shop_forge', item_id: 'item_blade', quantity: 1 });
  assert.equal(sold.isError, false);
  assert.equal(sold.report.total_price, 25);
  assert.equal(world.characters.pc?.stats.find((s) => s.name === 'Silver')?.value, 85);
  assert.equal(world.items.item_blade, undefined);
  assert.equal(world.modules.market?.shops.shop_forge?.wares.item_blade?.stock, 2);

  // Sell an unlisted item by passing unit_price.
  upsertItem(world, { id: 'item_pelt', name: 'Wolf Pelt', quantity: 2, ownerId: 'pc' });
  const soldPelt = run('trade', world, {
    side: 'sell',
    shop_id: 'shop_forge',
    item_id: 'item_pelt',
    quantity: 2,
    unit_price: 10,
  });
  assert.equal(soldPelt.isError, false);
  assert.equal(world.characters.pc?.stats.find((s) => s.name === 'Silver')?.value, 105);

  // The blacksmith is shown his own shop in a talk turn.
  const session = makeSession(world);
  const smithInit = buildActorInit(session, world.characters.npc_smith!, 'How much for a blade?', 3, 8, ['market']);
  assert.match(smithInit.prompt, /<market>\n\{"currency":"Silver"/);
  assert.match(smithInit.prompt, /"you_keep_it":true/);
});

// --- clues -------------------------------------------------------------------

test('clues: links evidence both ways, keeps hidden clues secret until revealed, and tracks deductions', () => {
  const world = worldWithTown();

  const recorded = run('record', world, {
    clues: {
      clues: [
        { id: 'clue_ash', title: 'hearth-ash on the latch', kind: 'evidence', source: 'Cellar door' },
        {
          id: 'clue_boots',
          title: 'Muddy boots by the well',
          kind: 'observation',
          source: 'Courtyard',
          links: ['clue_ash'],
        },
        { id: 'clue_secret', title: 'Forged seal in the vestry', kind: 'document', hidden: true },
      ],
      deductions: [
        {
          id: 'ded_inside_job',
          title: 'Someone inside unbarred the cellar',
          conclusion: 'The latch was smudged from the inside.',
          clue_ids: ['clue_ash', 'clue_boots'],
          status: 'open',
        },
      ],
    },
    suggestions: ['Inspect'],
  });
  assert.equal(recorded.isError, false);
  // Hidden clue is not announced; the two visible clues and the deduction are.
  assert.deepEqual(
    recorded.events.map((e: WorldEvent) => e.type),
    ['clue_found', 'clue_found', 'deduction_made'],
  );
  // Links run both ways automatically.
  assert.deepEqual(world.modules.clues?.clues.clue_ash?.links, ['clue_boots']);
  assert.deepEqual(world.modules.clues?.clues.clue_boots?.links, ['clue_ash']);

  // Reveal the hidden clue and confirm the deduction.
  const revealed = run('record', world, {
    clues: {
      clues: [{ id: 'clue_secret', hidden: false }],
      deductions: [{ id: 'ded_inside_job', status: 'confirmed' }],
    },
    suggestions: ['Confront'],
  });
  assert.deepEqual(revealed.events, [
    { type: 'clue_found', id: 'clue_secret', title: 'Forged seal in the vestry', kind: 'document', source: '' },
    { type: 'deduction_made', id: 'ded_inside_job', title: 'Someone inside unbarred the cellar', status: 'confirmed' },
  ]);

  // Removing a clue cleans up links pointing to it.
  run('record', world, {
    clues: { clues: [{ id: 'clue_boots', remove: true }] },
    suggestions: ['Continue'],
  });
  assert.deepEqual(world.modules.clues?.clues.clue_ash?.links, []);
  assert.deepEqual(world.modules.clues?.deductions.ded_inside_job?.clueIds, ['clue_ash']);
});

// --- travel ------------------------------------------------------------------

test('travel: charts routes, resolves journeys by pace and hazard, and halts mid-road on an ambush', () => {
  const world = worldWithTown();

  const charted = run('record', world, {
    travel: {
      routes: [
        {
          id: 'route_ridge',
          name: 'Pine Ridge Path',
          from_id: 'loc_square',
          to_id: 'loc_abbey',
          hours: 4,
          terrain: 'mountain path',
          hazard: 'perilous',
        },
      ],
    },
    suggestions: ['Set out'],
  });
  assert.deepEqual(charted.events, [
    {
      type: 'route_discovered',
      id: 'route_ridge',
      name: 'Pine Ridge Path',
      fromName: 'Market Square',
      toName: 'High Abbey',
      hazard: 'perilous',
    },
  ]);
  assert.ok(world.locations.loc_square?.connections.includes('loc_abbey'));

  // Cautious pace (+25% hours -> 5h) with a low roll (20) on a perilous road is clear and moves the scene.
  assert.equal(resolveJourney('perilous', 'cautious', 4, faces(100, 20)).outcome, 'clear');
  const safeTrip = run('journey', world, { to_id: 'loc_abbey', pace: 'cautious' }, faces(100, 20));
  assert.equal(safeTrip.isError, false);
  assert.equal(safeTrip.report.arrived, true);
  assert.equal(safeTrip.report.hours_spent, 5);
  assert.equal(world.scene.locationId, 'loc_abbey');

  // Forced march back (-25% hours -> 3h) with a high roll (95) triggers an ambush mid-route: scene stays at High Abbey.
  const ambushed = run('journey', world, { to_id: 'loc_square', pace: 'forced' }, faces(100, 95));
  assert.equal(ambushed.isError, false);
  assert.equal(ambushed.report.outcome, 'ambush');
  assert.equal(ambushed.report.arrived, false);
  assert.equal(ambushed.report.hours_spent, 2);
  assert.equal(world.scene.locationId, 'loc_abbey');
  assert.equal(world.modules.travel?.hoursTravelled, 7);

  // A blocked route refuses travel until cleared.
  run('record', world, {
    travel: { routes: [{ id: 'route_ridge', blocked: true }] },
    suggestions: ['Wait'],
  });
  assert.equal(run('journey', world, { to_id: 'loc_square' }).isError, true);
});

// --- deck --------------------------------------------------------------------

test('deck: draws without replacement from the built-in fate deck, custom decks, and weighted tables', () => {
  const world = worldWithTown();

  // Drawing from "fate_deck" works without prior setup and removes drawn cards from the remaining pile.
  const firstDraw = run('draw', world, { deck_id: 'fate_deck', count: 2, reason: 'The seer turns two cards' }, faces(100, 1, 80, 1, 20));
  assert.equal(firstDraw.isError, false);
  assert.equal(firstDraw.events[0]?.type, 'card_drawn');
  assert.equal(world.modules.deck?.decks.fate_deck?.remaining.length, 20);
  assert.equal(world.modules.deck?.decks.fate_deck?.drawn.length, 2);

  // Create a custom 2-card deck and a weighted table in record.deck.
  run('record', world, {
    deck: {
      decks: [
        {
          id: 'deck_omen',
          name: 'Omen Deck',
          reversals: false,
          cards: [
            { id: 'c_crow', name: 'The Crow', upright: 'A watcher in the trees.' },
            { id: 'c_bell', name: 'The Bell', upright: 'Vespers ring out.' },
          ],
        },
      ],
      tables: [
        {
          id: 'tbl_weather',
          name: 'Mountain Weather',
          entries: [
            { id: 'w_mist', label: 'Cold Mist', description: 'Visibility drops.', weight: 3 },
            { id: 'w_gale', label: 'Bitter Gale', description: 'Torches gutter.', weight: 1 },
          ],
        },
      ],
    },
    suggestions: ['Draw'],
  });

  const d1 = run('draw', world, { deck_id: 'deck_omen', count: 2, reason: 'Draw all omens' });
  assert.equal(d1.isError, false);
  assert.equal(world.modules.deck?.decks.deck_omen?.remaining.length, 0);
  // Drawing again when empty fails unless shuffle_first is true.
  assert.equal(run('draw', world, { deck_id: 'deck_omen', reason: 'Empty pile' }).isError, true);
  const reshuffled = run('draw', world, { deck_id: 'deck_omen', shuffle_first: true, reason: 'Reshuffled pile' });
  assert.equal(reshuffled.isError, false);
  assert.equal(world.modules.deck?.decks.deck_omen?.remaining.length, 1);

  // Roll on the weighted table.
  const rolled = run('draw', world, { table_id: 'tbl_weather', reason: 'Morning sky' }, faces(4, 4));
  assert.equal(rolled.isError, false);
  assert.equal(rolled.events[0]?.type, 'table_rolled');
  assert.equal((rolled.report.result as { id: string }).id, 'w_gale');
});

// --- reputation --------------------------------------------------------------

test('reputation: tracks standing tiers, titles, and heat, and exposes them to characters in talk turns', () => {
  const world = worldWithTown();

  assert.deepEqual([-80, -40, -15, 0, 40, 80].map(reputationTier), [
    'hunted',
    'reviled',
    'distrusted',
    'neutral',
    'respected',
    'revered',
  ]);

  const updated = run('record', world, {
    reputation: [
      {
        id: 'rep_abbey',
        name: 'Order of the High Abbey',
        change: 35,
        title: 'Friend of the Cloister',
        reason: 'Recovered the reliquary',
      },
      {
        id: 'rep_watch',
        name: 'City Watch',
        set: -30,
        heat: 4,
        reason: 'Broke the curfew gate',
      },
    ],
    suggestions: ['Continue'],
  });
  assert.equal(updated.isError, false);
  assert.equal(updated.events.length, 2);
  assert.equal(world.modules.reputation?.standings.rep_abbey?.score, 35);
  assert.equal(world.modules.reputation?.standings.rep_watch?.heat, 4);

  const session = makeSession(world);
  const smithInit = buildActorInit(session, world.characters.npc_smith!, 'Good evening.', 3, 8, ['reputation']);
  assert.match(smithInit.prompt, /<player_reputation>/);
  assert.match(smithInit.prompt, /Friend of the Cloister/);
  assert.match(smithInit.prompt, /"wanted_heat":4/);
});

// --- external plugins --------------------------------------------------------

const sampleAlchemyPlugin: PluginManifest = {
  id: 'alchemy',
  category: 'rules',
  glyph: '⚗',
  name: { en: 'Alchemy & Brewing', zh: '炼金与丹药' },
  tagline: {
    en: 'Brew elixirs and track volatile reagents.',
    zh: '调配灵药并追踪不稳定的药材。',
  },
  description: {
    en: 'Adds a cauldron brewing roll and a ledger of alchemical formulas and reagent potency.',
    zh: '为故事加入丹炉炼制检定，以及丹方与药力的记录账本。',
  },
  guide: {
    en: 'Use brew_elixir whenever the player attempts to distil or transmute a potion. Record known formulas and their potency in record.alchemy so the player can track their progress.',
    zh: '当玩家尝试炼制丹药或调配药剂时，先调用 brew_elixir 判定成败。在 record.alchemy 中记录已掌握的丹方及其药力品阶，以便玩家在面板中查看。',
  },
  reachesCharacters: true,
  record: {
    description: 'Alchemical formulas and brewed elixirs.',
    fields: [
      { key: 'potency', label: { en: 'Potency', zh: '药力' }, type: 'number', min: 1, max: 10 },
      { key: 'effect', label: { en: 'Effect', zh: '功效' }, type: 'string' },
    ],
  },
  tools: [
    {
      name: 'brew_elixir',
      description: 'Roll 2d6 against target 8 to brew an elixir.',
      kind: 'roll',
      dice: '2d6',
      target: 8,
      signature: 'brew_elixir(modifier?, reason)',
    },
  ],
};

test('external plugins: can be installed via API, persisted to disk, used by the GM, and uninstalled', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'roleplay-plugins-'));
  try {
    clearPlugins();
    const app = createApp({
      sessions: new SessionStore(dataDir),
      settings: new SettingsStore(dataDir, {}),
      images: new ImageStore(dataDir),
      plugins: new PluginStore(dataDir),
      createProvider: () => new MockProvider({ delayMs: 0 }),
      createPainter: () => null,
    });
    const send = (method: string, url: string, body?: unknown) =>
      app.request(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });

    // Rejects a plugin that tries to shadow a built-in module id.
    const bad = await send('POST', '/api/plugins', { ...sampleAlchemyPlugin, id: 'dice' });
    assert.equal(bad.status, 400);

    // Install the alchemy plugin.
    const installed = await send('POST', '/api/plugins', sampleAlchemyPlugin);
    assert.equal(installed.status, 201);

    const library = (await (await send('GET', '/api/modules')).json()) as ModuleLibraryResponse;
    const alchemyEntry = library.modules.find((m) => m.id === ('alchemy' as never));
    assert.ok(alchemyEntry);
    assert.deepEqual(alchemyEntry.tools, ['brew_elixir']);
    assert.equal(alchemyEntry.plugin?.glyph, '⚗');

    // Subscribe to alchemy alongside dice.
    const subRes = await send('PUT', '/api/settings', { subscribedModules: ['dice', 'alchemy'] });
    assert.equal(subRes.status, 200);
    const settings = (await subRes.json()) as PublicSettings;
    assert.ok(settings.subscribedModules.includes('alchemy' as never));

    // Use the plugin's tool and record section in the toolbox.
    const world = worldWithTown();
    const box = getToolbox({ illustrations: false, modules: ['dice', 'alchemy' as never] });
    const brew = box.get('brew_elixir');
    assert.ok(brew);
    const brewOut = brew.run(world, { modifier: 2, reason: 'Distilling moon-dew' }, { random: faces(6, 4, 4), narrate: () => {} });
    assert.equal(brewOut.isError, false);
    assert.equal(JSON.parse(brewOut.content).success, true);

    const rec = box.get('record')!;
    const recOut = rec.run(
      world,
      {
        alchemy: [{ id: 'elix_moon', name: 'Moon-Dew Draught', potency: 7, effect: 'Restores clarity' }],
        suggestions: ['Drink'],
      },
      { random: () => 0.5, narrate: () => {} },
    );
    assert.equal(recOut.isError, false);
    assert.equal(world.modules.custom?.alchemy?.entries.elix_moon?.values.potency, 7);

    // Uninstall the plugin.
    const deleted = await send('DELETE', '/api/plugins/alchemy');
    assert.equal(deleted.status, 200);
  } finally {
    clearPlugins();
    await rm(dataDir, { recursive: true, force: true });
  }
});
