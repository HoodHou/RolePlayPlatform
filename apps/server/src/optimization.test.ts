import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  createEmptyWorld,
  inferSandboxRegionKind,
  matchSandboxResourcePools,
  MODULE_IDS,
  sandboxRegionStability,
  sandboxStepPresets,
  type ModuleOperationResponse,
  type Session,
} from '@roleplay/shared';
import { createApp } from './app';
import { buildTurnInit, DEFAULT_TUNING } from './engine/context';
import { gameMasterView } from './engine/memory';
import { executeDirective } from './engine/moduleOps';
import { clearPlugins, lookupModule, PluginStore } from './engine/modules';
import { getPrompts } from './engine/prompts';
import { getToolbox, type ToolContext } from './engine/tools';
import { AppError } from './errors';
import { MockPainter } from './images/mock';
import { MockProvider } from './llm/mock';
import { OpenAIResponsesProvider } from './llm/openaiResponses';
import type { ConversationInit, LLMProvider } from './llm/types';
import { ImageStore } from './store/imageStore';
import { SessionStore } from './store/sessionStore';
import { SettingsStore } from './store/settingsStore';

function dummyToolCtx(_turn = 1, rand = 0.5): ToolContext {
  return {
    random: () => rand,
    narrate: () => {},
  };
}

test('Schema & prompt compaction: strips redundant JSON Schema boilerplate while keeping strict Zod validation', () => {
  const toolbox = getToolbox({ modules: MODULE_IDS, illustrations: true, choosing: true });
  const serializedTools = JSON.stringify(toolbox.specs);
  const recordSpec = toolbox.specs.find((s) => s.name === 'record');
  assert.ok(recordSpec);
  const recordChars = JSON.stringify(recordSpec).length;

  // Baseline before optimization: tools = 71,327 chars, record = 52,833 chars.
  assert.ok(
    !serializedTools.includes('"$schema"'),
    'top-level $schema metadata should be stripped from tool schemas',
  );
  assert.ok(
    !serializedTools.includes('"additionalProperties":false'),
    'recursive additionalProperties:false boilerplate should be stripped from tool schemas',
  );
  assert.ok(recordChars < 44_000, `expected compacted record schema < 44k chars, got ${recordChars}`);
  assert.ok(
    serializedTools.length < 61_000,
    `expected compacted 17-module tools < 61k chars, got ${serializedTools.length}`,
  );

  // Runtime Zod strictness must still reject unknown properties.
  const world = createEmptyWorld();
  const recordTool = toolbox.get('record');
  assert.ok(recordTool);
  const badResult = recordTool.run(
    world,
    { world: { title: 'Test', unexpected_extra_field: 123 } },
    dummyToolCtx(1),
  );
  assert.equal(badResult.isError, true);

  // Actor system prompt only mentions module tags that are active in the story.
  const zhPrompts = getPrompts('zh');
  const minimalActorSys = zhPrompts.actorSystemFor(['dice']);
  const imperialActorSys = zhPrompts.actorSystemFor(['court', 'lineage', 'domain', 'bonds']);
  assert.ok(!minimalActorSys.includes('<court_standing>'));
  assert.ok(!minimalActorSys.includes('<royal_household>'));
  assert.ok(imperialActorSys.includes('<court_standing>'));
  assert.ok(imperialActorSys.includes('<royal_household>'));
  assert.ok(minimalActorSys.length < imperialActorSys.length);
});

test('gameMasterView & viewForGM compact heavy module state, strip UI-only fields, and omit settled clutter', () => {
  const world = createEmptyWorld();
  world.turn = 4;
  world.suggestions = ['Option A', 'Option B', 'Option C'];

  const toolbox = getToolbox({ modules: ['court', 'deck', 'calendar'], illustrations: false });
  const recordTool = toolbox.get('record')!;
  const drawTool = toolbox.get('draw')!;

  const initRes = recordTool.run(
    world,
    {
      world: { title: '大乾王朝' },
      locations: [{ id: 'hall', name: '奉天殿', description: '金砖墁地' }],
      scene: { location_id: 'hall', summary: '早朝初散' },
      characters: [
        {
          id: 'emp',
          name: '萧景琰',
          is_player: true,
          location_id: 'hall',
          stats: [{ name: '银两', value: 200 }],
        },
        {
          id: 'zhang',
          name: '张居正',
          role: '首辅',
          location_id: 'hall',
        },
      ],
      memories: [{ character_id: 'zhang', text: '曾密奏考成法', importance: 4 }],
      suggestions: ['Option A', 'Option B'],
    },
    dummyToolCtx(1),
  );
  assert.equal(initRes.isError, false, initRes.content);
  world.characters.zhang!.imageUrl = '/api/images/portrait_zhang.png';

  // Trigger creation of the 22-card built-in fate_deck
  drawTool.run(world, { deck_id: 'fate_deck', count: 1, reason: '占问国运' }, dummyToolCtx(2, 0.2));

  // Populate court memorials/edicts and calendar settled items
  const modRes = recordTool.run(
    world,
    {
      suggestions: ['Option A', 'Option B'],
      court: {
        regime_name: '大乾朝廷',
        memorials: [
          {
            id: 'mem_old',
            title: '请赈陕北疏',
            author_name: '孙传庭',
            summary: '陕北连旱三载，饥民遍野，急需拨银十万两赈济灾黎。',
            proposal: '速发内帑十万两。',
            status: 'approved',
            ruling: '准奏',
          },
          {
            id: 'mem_pending',
            title: '请开海禁疏',
            author_name: '徐光启',
            summary: '漳泉海商云集，宜设市舶司征税充饷。',
            proposal: '于月港设关收税。',
            status: 'pending',
          },
        ],
        edicts: [
          { id: 'ed_old', title: '旧盐法', description: '长篇旧制说明', effect: '旧效', active: false },
          { id: 'ed_now', title: '考成新法', description: '核实吏治', effect: '治政效率提升', active: true },
        ],
      },
      calendar: {
        now: { day: 3, hour: 9 },
        schedule: [
          { id: 'ev_done', day: 4, hour: 8, title: '旧祭礼', status: 'done' },
          { id: 'ev_next', day: 5, hour: 12, title: '秋狝大阅' },
        ],
      },
    },
    dummyToolCtx(3),
  );
  assert.equal(modRes.isError, false, modRes.content);

  const gmView = gameMasterView(world, '', 4, ['court', 'deck', 'calendar']) as any;

  // UI-only fields stripped
  assert.equal(gmView.suggestions, undefined);
  assert.equal(gmView.characters.zhang.imageUrl, undefined);
  assert.equal(gmView.characters.zhang.memories[0].id, undefined);

  // Deck remaining card array replaced with remainingCount
  const gmDeck = gmView.modules.deck.decks.fate_deck;
  assert.equal(gmDeck.remaining, undefined);
  assert.equal(gmDeck.remainingCount, 21);

  // Court settled memorial omits verbose summary/proposal while pending keeps them
  assert.equal(gmView.modules.court.memorials.mem_old.summary, undefined);
  assert.equal(gmView.modules.court.memorials.mem_old.ruling, '准奏');
  assert.ok(gmView.modules.court.memorials.mem_pending.proposal);
  assert.equal(gmView.modules.court.edicts.ed_old.description, undefined);
  assert.ok(gmView.modules.court.edicts.ed_now.effect);

  // Calendar omits done/cancelled schedule entries
  assert.equal(gmView.modules.calendar.schedule.ev_done, undefined);
  assert.equal(gmView.modules.calendar.schedule.ev_next.title, '秋狝大阅');
});

test('Zero-token instant actions, batched directive turns, atomic rollback, and ?slim=1 payloads work end-to-end', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'roleplay-opt-'));
  try {
    clearPlugins();
    const sessions = new SessionStore(dataDir);
    const settings = new SettingsStore(dataDir, {});
    const images = new ImageStore(dataDir);
    const plugins = new PluginStore(dataDir);
    await plugins.loadAll();

    let providerCalls = 0;
    let lastGmPrompt = '';
    let shouldFailNextTurn = false;
    const baseMock = new MockProvider({ delayMs: 0 });

    const trackingProvider: LLMProvider = {
      kind: 'mock',
      startConversation(init: ConversationInit) {
        providerCalls += 1;
        if (init.meta.kind !== 'talk') {
          lastGmPrompt = init.prompt;
        }
        if (shouldFailNextTurn) {
          return {
            async step() {
              throw new AppError('provider_error', 'Simulated upstream LLM outage');
            },
            submitToolResults() {},
            addUserMessage() {},
          };
        }
        return baseMock.startConversation(init);
      },
    };

    const app = createApp({
      sessions,
      settings,
      images,
      plugins,
      createProvider: () => trackingProvider,
      createPainter: () => null,
    });

    // Subscribe to all built-in modules first so the test session can activate all 10 modules
    const subRes = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscribedModules: [...MODULE_IDS] }),
    });
    assert.equal(subRes.status, 200);

    // 1. Create a session with all interactive simulation modules enabled
    const createRes = await app.request('/api/sessions?slim=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: 'zh',
        premise: '崇祯元年，内忧外患',
        modules: [
          'dice',
          'court',
          'sandbox',
          'market',
          'domain',
          'lineage',
          'espionage',
          'progression',
          'deck',
          'clocks',
        ],
      }),
    });
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as Session;

    // Start turn 1 so world.turn >= 1
    const startRes = await app.request(`/api/sessions/${created.id}/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'start' }),
    });
    assert.equal(startRes.status, 200);
    await startRes.text();

    // Seed rich module state into the session so we can exercise every module's instant ops
    const live = await sessions.get(created.id);
    assert.ok(live);
    const playerId = live.world.playerId!;
    live.world.characters[playerId]!.stats = [{ name: '银两', value: 500 }];
    live.world.items.jade_seal = {
      id: 'jade_seal',
      name: '古玉佩',
      description: '温润白玉',
      quantity: 2,
      ownerId: playerId,
    };
    live.world.characters.minister_sun = {
      id: 'minister_sun',
      name: '孙承宗',
      role: '兵部尚书',
      description: '老成谋国',
      personality: '刚毅',
      appearance: '须发皆白',
      voice: '沉稳',
      goals: '固守辽东',
      secrets: '',
      isPlayer: false,
      locationId: live.world.scene.locationId,
      attitude: '忠心',
      status: '在任',
      stats: [],
      memories: [],
    };
    live.world.characters.consort_zhou = {
      id: 'consort_zhou',
      name: '周皇后',
      role: '皇后',
      description: '端庄节俭',
      personality: '温婉',
      appearance: '素衣簪花',
      voice: '温和',
      goals: '安顿六宫',
      secrets: '',
      isPlayer: false,
      locationId: live.world.scene.locationId,
      attitude: '敬爱',
      status: '坤宁宫主位',
      stats: [],
      memories: [],
    };
    live.world.characters.prince_ci = {
      id: 'prince_ci',
      name: '朱慈烺',
      role: '皇长子',
      description: '聪颖好学',
      personality: '仁厚',
      appearance: '少年储君',
      voice: '清朗',
      goals: '精研治国',
      secrets: '',
      isPlayer: false,
      locationId: live.world.scene.locationId,
      attitude: '恭谨',
      status: '东宫伴读',
      stats: [],
      memories: [],
    };

    const toolbox = getToolbox({ modules: live.modules, illustrations: false });
    const recordTool = toolbox.get('record')!;
    const patchRes = recordTool.run(
      live.world,
      {
        suggestions: ['继续视朝', '召见阁臣'],
        court: {
          regime_name: '大明朝廷',
          ruler_title: '皇帝',
          metrics: [{ id: 'treasury', name: '太仓银两', value: 120 }],
          factions: [{ id: 'donglin', name: '东林党', influence: 55 }],
          officials: [
            {
              character_id: 'minister_sun',
              office: '兵部尚书',
              department: '兵部',
              governance: 82,
              military: 91,
              intrigue: 65,
              loyalty: 92,
              influence: 75,
            },
          ],
          memorials: [
            {
              id: 'mem_liao',
              author_id: 'minister_sun',
              title: '请修宁远城防疏',
              summary: '关外烽烟日紧，亟需加固宁远棱堡。',
              proposal: '拨银修筑炮台。',
              urgency: 'urgent',
            },
            {
              id: 'mem_tax',
              author_id: 'minister_sun',
              title: '请裁驿站冗费疏',
              summary: '驿递靡费甚巨。',
              proposal: '核减冒滥驿卒。',
              urgency: 'routine',
            },
          ],
        },
        sandbox: {
          period: '崇祯元年春',
          resources: [{ id: 'silver', name: '饷银' }],
          factions: [
            {
              id: 'ming',
              name: '大明',
              is_player: true,
              resources: [{ id: 'silver', value: 100 }],
              income: [{ id: 'silver', value: 25 }],
            },
            {
              id: 'jin',
              name: '后金',
              resources: [{ id: 'silver', value: 80 }],
              income: [{ id: 'silver', value: 15 }],
            },
          ],
          regions: [
            { id: 'ningyuan', name: '宁远', x: 5, y: 2, owner_id: 'ming', strength: 40, neighbors: ['guangning'] },
            { id: 'guangning', name: '广宁', x: 6, y: 2, owner_id: null, strength: 10, neighbors: ['ningyuan'] },
          ],
          relations: [{ a: 'ming', b: 'jin', stance: 'war' }],
        },
        market: {
          currency: '银两',
          currency_stat: '银两',
          shops: [
            {
              id: 'imperial_bazaar',
              name: '京师官市',
              wares: [{ id: 'warhorse', name: '宣府战马', price: 80, stock: 5 }],
            },
          ],
        },
        domain: {
          name: '京营军工坊',
          tier: '国都重镇',
          resources: [{ id: 'iron', name: '精铁', amount: 50, per_cycle: 12 }],
          facilities: [
            { id: 'foundry', name: '神机铸炮局', level: 1, max_level: 3, status: 'operational', segments: 4 },
          ],
        },
        lineage: {
          house_name: '大明朱氏宗室',
          consorts: [{ character_id: 'consort_zhou', title: '皇后', palace: '坤宁宫', rank_order: 1, favor: 80 }],
          heirs: [{ character_id: 'prince_ci', order: '皇长子', title: '皇长子', aptitude: { governance: 60, learning: 65 } }],
        },
        espionage: {
          agency_name: '东厂',
          network_power: 65,
          agents: [{ id: 'spy_1', codename: '夜枭', cover: '账房先生', target_name: '晋商票号', infiltration: 45, exposure: 4 }],
        },
        progression: {
          system_name: '帝王心术',
          realm: '初政',
          ladder: ['初政', '乾纲独断', '中兴圣主'],
          xp: 90,
          xp_max: 100,
          deviation: 20,
          abilities: [{ id: 'imperial_awe', name: '天威难测', equipped: false }],
        },
        deck: {
          decks: [
            {
              id: 'omen_deck',
              name: '钦天监星象签',
              cards: [
                { id: 'c1', name: '紫微明朗', upright: '朝局渐稳' },
                { id: 'c2', name: '荧惑守心', upright: '边关示警' },
              ],
            },
          ],
        },
        clocks: [{ id: 'border_crisis', name: '关宁边患', segments: 6, filled: 2, description: '后金叩关' }],
      },
      dummyToolCtx(1),
    );
    assert.equal(patchRes.isError, false, patchRes.content);
    await sessions.save(live);

    const callsBeforeZeroTokenOps = providerCalls;
    const inputTokensBefore = live.usage?.inputTokens ?? 0;

    const runAction = async (moduleId: string, op: string, params: Record<string, unknown>) => {
      const res = await app.request(`/api/sessions/${created.id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          directive: { moduleId, op, params, label: `${moduleId}.${op}` },
        }),
      });
      assert.equal(res.status, 200, `Expected 200 for ${moduleId}.${op}, got ${res.status}: ${await res.clone().text()}`);
      return (await res.json()) as ModuleOperationResponse;
    };

    // 2. Execute 0-token instant operations across all 9 interactive modules!
    await runAction('court', 'rule_memorial', {
      id: 'mem_liao',
      status: 'approved',
      ruling: '准奏，速拨内帑修筑炮台',
      issue_edict: true,
    });
    await runAction('court', 'manage_official', {
      character_id: 'minister_sun',
      office: '内阁首辅兼督师蓟辽',
      assignment: '督办关宁防务',
    });
    await runAction('court', 'hold_court', {
      agenda: '核实天下钱粮考成',
      domain: 'governance',
      lead_official_id: 'minister_sun',
      opposing_faction_id: 'donglin',
    });
    await runAction('sandbox', 'region_decree', { region_id: 'ningyuan', action: 'fortify', delta: 5 });
    await runAction('sandbox', 'region_decree', { region_id: 'guangning', action: 'claim' });
    await runAction('sandbox', 'simulate', { advance: {} });
    await runAction('market', 'trade', { side: 'buy', shop_id: 'imperial_bazaar', item_id: 'warhorse', quantity: 1 });
    await runAction('market', 'trade', {
      side: 'sell',
      shop_id: 'imperial_bazaar',
      item_id: 'jade_seal',
      quantity: 1,
      unit_price: 30,
    });
    await runAction('domain', 'assign_steward', { facility_id: 'foundry', steward_id: 'minister_sun' });
    await runAction('domain', 'set_facility_status', { facility_id: 'foundry', status: 'building' });
    await runAction('domain', 'develop_domain', { facility_id: 'foundry' });
    await runAction('lineage', 'designate_heir', { character_id: 'prince_ci' });
    await runAction('lineage', 'assign_tutor', { character_id: 'prince_ci', tutor_id: 'minister_sun' });
    await runAction('lineage', 'update_consort', { character_id: 'consort_zhou', favor_delta: 5 });
    await runAction('lineage', 'nurture_heir', {
      character_id: 'prince_ci',
      focus: 'governance',
      intensity: 'strict',
    });
    await runAction('espionage', 'run_operation', {
      agent_id: 'spy_1',
      operation: 'recon',
      reason: '密查晋商走私铁器',
    });
    await runAction('espionage', 'set_agent_status', { agent_id: 'spy_1', status: 'recalled' });
    await runAction('progression', 'cultivate', { mode: 'meditate', amount: 15 });
    await runAction('progression', 'cultivate', { mode: 'cleanse', amount: 15 });
    await runAction('progression', 'toggle_ability', { ability_id: 'imperial_awe', equipped: true });
    await runAction('progression', 'breakthrough', {
      target_realm: '乾纲独断',
      catalyst_bonus: 45,
      reason: '乾纲渐振',
    });
    await runAction('deck', 'draw', { deck_id: 'omen_deck', count: 1, reason: '夜观天象' });
    await runAction('deck', 'reset_deck', { deck_id: 'omen_deck' });
    const lastOp = await runAction('clocks', 'tick_clock', { id: 'border_crisis', delta: 1 });

    // Every single one of those 24 operations ran at ZERO LLM calls & ZERO token usage!
    assert.equal(providerCalls, callsBeforeZeroTokenOps, '0-token instant ops must never invoke the LLM provider');
    assert.equal(lastOp.world.modules.court?.memorials.mem_liao?.status, 'approved');
    assert.ok(lastOp.world.modules.court?.edicts.edict_mem_liao?.active);
    assert.equal(lastOp.world.modules.sandbox?.regions.guangning?.ownerId, 'ming');
    assert.equal(lastOp.world.modules.sandbox?.round, 1);
    assert.equal(lastOp.world.modules.lineage?.heirs.prince_ci?.isHeirApparent, true);
    assert.equal(lastOp.world.modules.espionage?.agents.spy_1?.status, 'recalled');
    assert.equal(lastOp.world.modules.progression?.abilities.imperial_awe?.equipped, true);
    assert.equal(lastOp.world.modules.deck?.decks.omen_deck?.remaining.length, 2);
    assert.equal(lastOp.world.modules.clocks?.clocks.border_crisis?.filled, 3);
    assert.ok(Array.isArray(lastOp.snapshotTurns) && lastOp.snapshotTurns.length >= 2);

    // 3. Slim payload vs full payload check
    const slimGet = (await (await app.request(`/api/sessions/${created.id}?slim=1`)).json()) as Session;
    assert.equal(slimGet.snapshots, undefined, 'GET ?slim=1 omits snapshots');
    assert.deepEqual(slimGet.snapshotTurns, [0, 1]);
    assert.equal(slimGet.usage?.inputTokens ?? 0, inputTokensBefore);

    const fullGet = (await (await app.request(`/api/sessions/${created.id}`)).json()) as Session;
    assert.ok(Array.isArray(fullGet.snapshots) && fullGet.snapshots.length >= 2);

    // 4. Atomic rollback if LLM provider fails during a batched directive turn
    shouldFailNextTurn = true;
    const failedTurnRes = await app.request(`/api/sessions/${created.id}/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'action',
        text: '',
        directives: [
          {
            moduleId: 'court',
            op: 'rule_memorial',
            params: { id: 'mem_tax', status: 'rejected', ruling: '暂缓' },
            label: '驳回 · 请裁驿站冗费疏',
          },
        ],
      }),
    });
    assert.equal(failedTurnRes.status, 200);
    const failedSse = await failedTurnRes.text();
    assert.match(failedSse, /event: error/);

    const afterFail = (await (await app.request(`/api/sessions/${created.id}?slim=1`)).json()) as Session;
    assert.equal(
      afterFail.world.modules.court?.memorials.mem_tax?.status,
      'pending',
      'failed turn must not mutate mem_tax',
    );

    // 5. Batched directives turn with empty composer text (`text: ""`) + `advisor_note` settles in 1 single turn
    shouldFailNextTurn = false;
    const callsBeforeBatchedTurn = providerCalls;
    const batchedRes = await app.request(`/api/sessions/${created.id}/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'action',
        text: '',
        directives: [
          {
            moduleId: 'court',
            op: 'rule_memorial',
            params: { id: 'mem_tax', status: 'approved', ruling: '准奏裁撤冗驿' },
            label: '准奏 · 请裁驿站冗费疏',
          },
          {
            moduleId: 'sandbox',
            op: 'region_decree',
            params: { region_id: 'ningyuan', action: 'mobilize', delta: 5 },
            label: '宁远 · 整军增戍',
          },
          {
            moduleId: 'court',
            op: 'advisor_note',
            params: { characterId: 'minister_sun' },
            label: '采纳孙承宗建言',
            aiNote: '孙承宗：宜先裁驿站浮费，移饷关宁铁骑。',
          },
        ],
      }),
    });
    assert.equal(batchedRes.status, 200);
    const batchedSse = await batchedRes.text();
    assert.match(batchedSse, /event: done/);

    assert.equal(providerCalls - callsBeforeBatchedTurn, 1, '3 directives settled in 1 single GM conversation');
    assert.match(lastGmPrompt, /<executed_directives>/);
    assert.match(lastGmPrompt, /准奏裁撤冗驿/);
    assert.match(lastGmPrompt, /孙承宗：宜先裁驿站浮费/);

    const afterBatched = (await (await app.request(`/api/sessions/${created.id}?slim=1`)).json()) as Session;
    assert.equal(afterBatched.world.turn, 2);
    assert.equal(afterBatched.world.modules.court?.memorials.mem_tax?.status, 'approved');
  } finally {
    clearPlugins();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('Prompt caching: buildTurnInit attaches deterministic cacheKey and OpenAIResponsesProvider forwards prompt_cache_key', async () => {
  const recordedBodies: any[] = [];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      recordedBodies.push(JSON.parse(raw));
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(
        [
          `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: '风雪夜归人。' })}\n\n`,
          `data: ${JSON.stringify({
            type: 'response.completed',
            response: {
              status: 'completed',
              output: [{ type: 'message', content: [{ type: 'output_text', text: '风雪夜归人。' }] }],
              usage: { input_tokens: 120, output_tokens: 12, input_tokens_details: { cached_tokens: 96 } },
            },
          })}\n\n`,
        ].join(''),
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const provider = new OpenAIResponsesProvider({
      apiKey: 'test-key',
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: 'gpt-5-mini',
      effort: 'low',
      maxOutputTokens: 2048,
    });

    const session: Session = {
      id: 'sess_cache_1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      language: 'zh',
      modules: ['dice'],
      modulesAuto: false,
      seed: { premise: '雪夜客栈', playerName: '沈舟', playerConcept: '刀客' },
      world: { ...createEmptyWorld(), turn: 1 },
      messages: [],
    };

    const init = buildTurnInit(session, { kind: 'action', text: '推门入店' }, 2, {
      ...DEFAULT_TUNING,
      illustrations: false,
      modules: ['dice'],
    });
    assert.equal(init.cacheKey, 'rp:sess_cache_1:gm');

    const conv = provider.startConversation(init);
    const step = await conv.step({
      onTextDelta: () => {},
      onToolInput: () => {},
      onStepReset: () => {},
      signal: new AbortController().signal,
    });

    assert.equal(recordedBodies.length, 1);
    assert.equal(recordedBodies[0].prompt_cache_key, 'rp:sess_cache_1:gm');
    assert.equal(step.usage.cachedInputTokens, 96);
  } finally {
    server.close();
  }
});

test('Strategic Sandbox overhaul: legacy《大虞危局》compatibility, corridors, mobilization, walls/relief/yields, commanders, and campaigns', () => {
  const world = createEmptyWorld();
  world.turn = 2;
  const toolbox = getToolbox({ modules: ['court', 'sandbox'], illustrations: false });
  const recordTool = toolbox.get('record')!;

  // Seed a legacy save shaped directly like《大虞危局》(without explicit kind/defense/stability fields)
  const seedRes = recordTool.run(
    world,
    {
      world: { title: '大虞危局' },
      locations: [{ id: 'hall', name: '奉天殿' }],
      scene: { location_id: 'hall', summary: '边关急报频传' },
      characters: [
        { id: 'emp', name: '朱承钧', is_player: true, location_id: 'hall' },
        { id: 'sun', name: '孙承宗', role: '蓟辽督师', location_id: 'hall' },
        { id: 'wule', name: '乌勒罕', role: '黑水铁骑首领', location_id: 'hall' },
      ],
      court: {
        regime_name: '大虞朝廷',
        officials: [
          {
            character_id: 'sun',
            office: '兵部尚书兼督师',
            department: '枢密兵曹',
            governance: 78,
            military: 92,
            intrigue: 65,
            loyalty: 95,
          },
        ],
      },
      suggestions: ['检阅边防', '召见督师'],
      sandbox: {
        period: '崇昭十七年早春',
        resources: [
          { id: 'res_silver', name: '可用银两估计' },
          { id: 'res_grain', name: '可用粮食估计' },
          { id: 'res_manpower', name: '可动员兵力估计' },
        ],
        factions: [
          {
            id: 'dayu',
            name: '大虞朝廷',
            is_player: true,
            leader_id: 'emp',
            resources: [
              { id: 'res_silver', value: 80_000 },
              { id: 'res_grain', value: 20_000 },
              { id: 'res_manpower', value: 30_000 },
            ],
            income: [
              { id: 'res_silver', value: -10_000 },
              { id: 'res_grain', value: -2_000 },
            ],
          },
          {
            id: 'heishui',
            name: '黑水铁骑',
            leader_id: 'wule',
            resources: [
              { id: 'res_silver', value: 15_000 },
              { id: 'res_grain', value: 12_000 },
              { id: 'res_manpower', value: 8_000 },
            ],
          },
        ],
        regions: [
          { id: 'shanxi', name: '陕内旱区', owner_id: null, x: 0, y: 2, terrain: '黄土旱塬', neighbors: ['tongguan'] },
          { id: 'tongguan', name: '潼关', owner_id: 'dayu', x: 2, y: 2, strength: 3000, neighbors: ['shanxi', 'jingji'] },
          { id: 'jingji', name: '京畿', owner_id: 'dayu', x: 4, y: 2, strength: 3000, neighbors: ['tongguan', 'shanhai'] },
          { id: 'shanhai', name: '山海关', owner_id: 'dayu', x: 6, y: 2, strength: 5000, neighbors: ['jingji', 'liaodong'] },
          {
            id: 'liaodong',
            name: '辽东军镇',
            owner_id: 'dayu',
            x: 8,
            y: 2,
            terrain: '边镇',
            strength: 4075,
            neighbors: ['shanhai', 'steppe'],
          },
          {
            id: 'steppe',
            name: '关外草原',
            owner_id: 'heishui',
            x: 8,
            y: 0,
            terrain: '寒漠草场',
            strength: 6000,
            neighbors: ['liaodong'],
          },
        ],
      },
    },
    dummyToolCtx(1),
  );
  assert.equal(seedRes.isError, false, seedRes.content);

  const board = world.modules.sandbox!;

  // 1. Legacy inference & Chinese resource pool auto-matching
  const pools = matchSandboxResourcePools(board);
  assert.equal(pools.funds?.id, 'res_silver');
  assert.equal(pools.grain?.id, 'res_grain');
  assert.equal(pools.manpower?.id, 'res_manpower');
  assert.equal(inferSandboxRegionKind(board.regions.jingji!), 'capital');
  assert.equal(inferSandboxRegionKind(board.regions.shanhai!), 'pass');
  assert.equal(inferSandboxRegionKind(board.regions.liaodong!), 'fortress');
  assert.equal(inferSandboxRegionKind(board.regions.steppe!), 'frontier');
  assert.equal(sandboxRegionStability(board.regions.shanxi!), 28);
  assert.deepEqual(sandboxStepPresets(30_000), [4000, 10000, 20000]);

  // 2. Multi-hop friendly corridor troop transfer (京畿 -> 山海关 -> 辽东军镇) at 0 treasury cost
  executeDirective(world, {
    moduleId: 'sandbox',
    op: 'transfer_troops',
    params: { from_region_id: 'jingji', to_region_id: 'liaodong', amount: 2000 },
    label: '调京营赴援辽东',
  });
  assert.equal(board.regions.jingji!.strength, 1000);
  assert.equal(board.regions.liaodong!.strength, 6075);
  assert.equal(board.factions.dayu!.resources.res_silver, 80_000);

  // Reject disconnected corridor if 山海关 temporarily falls
  board.regions.shanhai!.ownerId = 'heishui';
  assert.throws(() =>
    executeDirective(world, {
      moduleId: 'sandbox',
      op: 'transfer_troops',
      params: { from_region_id: 'jingji', to_region_id: 'liaodong', amount: 500 },
      label: '断路调兵应被拦截',
    }),
  );
  board.regions.shanhai!.ownerId = 'dayu';

  // 3. Mobilize reserve manpower into 辽东军镇 (deducts manpower + silver provisioning fee)
  executeDirective(world, {
    moduleId: 'sandbox',
    op: 'reinforce_garrison',
    params: { region_id: 'liaodong', amount: 3000 },
    label: '征调辽东新军',
  });
  assert.equal(board.regions.liaodong!.strength, 9075);
  assert.equal(board.factions.dayu!.resources.res_manpower, 27_000);
  assert.ok(board.factions.dayu!.resources.res_silver! < 80_000);

  // 4. Fortify walls on 辽东军镇
  const silverBeforeFortify = board.factions.dayu!.resources.res_silver!;
  executeDirective(world, {
    moduleId: 'sandbox',
    op: 'fortify_region',
    params: { region_id: 'liaodong', gain: 15 },
    label: '修筑辽东墩台',
  });
  assert.equal(board.regions.liaodong!.defense, 85); // fortress default 70 + 15
  assert.ok(board.factions.dayu!.resources.res_silver! < silverBeforeFortify);

  // 5. Assign cast minister 孙承宗 as commander of 辽东军镇 & check shownToCharacter awareness
  executeDirective(world, {
    moduleId: 'sandbox',
    op: 'assign_commander',
    params: { region_id: 'liaodong', commander_id: 'sun' },
    label: '命孙承宗督师辽东',
  });
  assert.equal(board.regions.liaodong!.commanderId, 'sun');
  const sandboxMod = lookupModule('sandbox')!;
  const sunView = sandboxMod.shownToCharacter!.of(world, 'sun') as any;
  assert.equal(sunView.you_command.region, '辽东军镇');
  assert.equal(sunView.you_command.garrison, 9075);

  // 6. March from 潼关 into unclaimed 陕内旱区, then pacify & develop it
  executeDirective(world, {
    moduleId: 'sandbox',
    op: 'launch_campaign',
    params: { from_region_id: 'tongguan', target_region_id: 'shanxi', force: 1200 },
    label: '收复陕内旱区',
  });
  assert.equal(board.regions.tongguan!.strength, 1800);
  assert.equal(board.regions.shanxi!.ownerId, 'dayu');
  assert.equal(board.regions.shanxi!.strength, 1200);

  board.regions.shanxi!.status = '流民饥荒';
  const grainBeforePacify = board.factions.dayu!.resources.res_grain!;
  executeDirective(world, {
    moduleId: 'sandbox',
    op: 'pacify_region',
    params: { region_id: 'shanxi', gain: 40 },
    label: '开仓赈济陕内',
  });
  assert.equal(board.regions.shanxi!.stability, 68); // 28 + 40 >= 65 clears crisis status
  assert.equal(board.regions.shanxi!.status, '');
  assert.ok(board.factions.dayu!.resources.res_grain! < grainBeforePacify);

  const grainIncomeBefore = board.factions.dayu!.income.res_grain!;
  executeDirective(world, {
    moduleId: 'sandbox',
    op: 'develop_region',
    params: { region_id: 'shanxi', yield_resource_id: 'res_grain', gain: 15 },
    label: '兴修泾渭屯田',
  });
  assert.ok(board.factions.dayu!.income.res_grain! > grainIncomeBefore);

  // 7. Launch campaign from 辽东军镇 (9075 led by 孙承宗, military 92 -> +2 edge) against 关外草原 (6000)
  const campaignReport = executeDirective(
    world,
    {
      moduleId: 'sandbox',
      op: 'launch_campaign',
      params: { from_region_id: 'liaodong', target_region_id: 'steppe', force: 8000 },
      label: '出塞北伐黑水铁骑',
    },
    () => 0.75, // solid attacker roll
  );
  assert.equal(board.regions.steppe!.ownerId, 'dayu');
  assert.ok((board.regions.steppe!.strength ?? 0) > 0 && (board.regions.steppe!.strength ?? 0) < 8000);
  assert.equal(board.regions.liaodong!.strength, 1075);
  assert.ok(campaignReport.events.some((ev) => ev.type === 'sandbox_battle' && ev.winner === 'attacker'));
  assert.ok(board.relations.some((rel) => rel.stance === 'war'));
});
