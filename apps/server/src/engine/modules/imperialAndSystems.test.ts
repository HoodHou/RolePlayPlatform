import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createEmptyWorld,
  MODULE_IDS,
  type Session,
  type WorldEvent,
  type WorldState,
} from '@roleplay/shared';
import { buildActorInit } from '../actor';
import { getToolbox, type ToolContext } from '../tools';
import { setScene, upsertCharacter, upsertLocation } from '../world';
import { listLibrary } from './index';

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

function worldWithPalace(): WorldState {
  const world = createEmptyWorld();
  world.title = '大乾王朝';
  upsertLocation(world, { id: 'loc_hall', name: '太和殿' });
  upsertLocation(world, { id: 'loc_harem', name: '长乐宫' });
  setScene(world, { locationId: 'loc_hall' });
  upsertCharacter(world, {
    id: 'pc_emperor',
    name: '萧景琰',
    isPlayer: true,
    role: '大乾天子',
    appearance: '青年帝王，玄金冕服，眉目冷峻',
  });
  upsertCharacter(world, {
    id: 'npc_chancellor',
    name: '林相如',
    role: '内阁首辅',
    locationId: 'loc_hall',
  });
  upsertCharacter(world, {
    id: 'npc_general',
    name: '霍镇北',
    role: '镇北侯',
    locationId: 'loc_hall',
  });
  upsertCharacter(world, {
    id: 'npc_consort',
    name: '苏晚晴',
    role: '贵妃',
    locationId: 'loc_harem',
  });
  upsertCharacter(world, {
    id: 'npc_prince1',
    name: '萧承乾',
    role: '皇长子',
    locationId: 'loc_hall',
  });
  upsertCharacter(world, {
    id: 'npc_prince2',
    name: '萧承泽',
    role: '皇次子',
    locationId: 'loc_hall',
  });
  upsertCharacter(world, {
    id: 'npc_uncle',
    name: '萧玄礼',
    role: '摄政皇叔',
    locationId: 'loc_hall',
  });
  world.turn = 3;
  return world;
}

function makeSession(world: WorldState): Session {
  const now = new Date().toISOString();
  return {
    id: 'sess-imperial',
    createdAt: now,
    updatedAt: now,
    language: 'zh',
    seed: { premise: '新帝登基，朝野暗流涌动。', playerName: '萧景琰', playerConcept: '少年天子' },
    modules: [...MODULE_IDS],
    modulesAuto: false,
    world,
    messages: [],
  };
}

// --- library catalog ---------------------------------------------------------

test('library: includes court, lineage, domain, espionage, and progression with tools and token estimates', () => {
  const catalog = listLibrary(MODULE_IDS);
  for (const id of ['court', 'lineage', 'domain', 'espionage', 'progression'] as const) {
    const entry = catalog.find((m) => m.id === id);
    assert.ok(entry, `module ${id} is listed in catalog`);
    assert.equal(entry.hasPanel, true);
    assert.equal(entry.keepsRecords, true);
    assert.equal(entry.subscribed, true);
    assert.ok(entry.promptTokens.en > 0 && entry.promptTokens.zh > 0);
    assert.ok(entry.tools.length >= 1, `module ${id} exposes its server tool`);
  }
  assert.equal(catalog.find((m) => m.id === 'court')?.reachesCharacters, true);
  assert.equal(catalog.find((m) => m.id === 'espionage')?.reachesCharacters, false);
});

// --- court -------------------------------------------------------------------

test('court: registers ministers, factions, memorials, and edicts, resolves hold_court, and hides loyalty/secrets from peers', () => {
  const world = worldWithPalace();

  const recorded = run('record', world, {
    court: {
      regime_name: '大乾朝廷',
      ruler_title: '皇帝',
      metrics: [
        { id: 'treasury', name: '国库银两', value: 500 },
        { id: 'stability', name: '民心安定', value: 70, max: 100 },
      ],
      factions: [
        {
          id: 'fac_qingliu',
          name: '清流党',
          leader_id: 'npc_chancellor',
          influence: 60,
          stance: '崇文抑武，严查贪墨',
        },
        {
          id: 'fac_xungui',
          name: '勋贵集团',
          leader_id: 'npc_general',
          influence: 40,
          stance: '增发边饷，世袭兵权',
        },
      ],
      officials: [
        {
          character_id: 'npc_chancellor',
          office: '内阁首辅',
          department: '内阁',
          rank: '正一品',
          faction_id: 'fac_qingliu',
          loyalty: 82,
          influence: 75,
          governance: 90,
          military: 35,
          intrigue: 78,
          assignment: '总理清丈田亩新政',
        },
        {
          character_id: 'npc_general',
          office: '兵部尚书',
          department: '六部',
          rank: '从一品',
          faction_id: 'fac_xungui',
          loyalty: 28,
          influence: 68,
          governance: 45,
          military: 92,
          intrigue: 50,
        },
      ],
      memorials: [
        {
          id: 'mem_land',
          author_id: 'npc_chancellor',
          title: '《请清丈江南隐田疏》',
          summary: '江南豪强兼并隐田，岁入日减。',
          proposal: '遣钦差赴江南清丈田亩，一体当差纳粮。',
          urgency: 'urgent',
        },
        {
          id: 'mem_secret',
          author_id: 'npc_general',
          title: '《北境密报疏》',
          summary: '北庭铁骑异动。',
          proposal: '密调神机营赴宣府。',
          urgency: 'secret',
        },
      ],
      edicts: [
        {
          id: 'ed_salt',
          title: '盐铁考成法',
          effect: '每季整肃盐引，岁入稳增',
        },
      ],
    },
    suggestions: ['召开早朝'],
  });

  assert.equal(recorded.isError, false);
  assert.deepEqual(
    recorded.events.map((e: WorldEvent) => e.type),
    [
      'official_appointed',
      'official_appointed',
      'memorial_submitted',
      'memorial_submitted',
      'edict_issued',
    ],
  );

  // Player character cannot be registered as an official.
  const badPlayerOfficial = run('record', world, {
    court: { officials: [{ character_id: 'pc_emperor', office: '皇帝' }] },
    suggestions: ['继续'],
  });
  assert.equal(badPlayerOfficial.isError, true);

  // Rule on a pending memorial with an imperial rescript ("朱批").
  const ruled = run('record', world, {
    court: {
      memorials: [
        {
          id: 'mem_land',
          status: 'approved',
          ruling: '准奏，着林相如督办江南清丈。',
        },
      ],
    },
    suggestions: ['退朝'],
  });
  assert.deepEqual(ruled.events, [
    {
      type: 'memorial_ruled',
      id: 'mem_land',
      title: '《请清丈江南隐田疏》',
      status: 'approved',
      ruling: '准奏，着林相如督办江南清丈。',
    },
  ]);

  // hold_court: chancellor (governance 90 -> +4, loyalty 82 -> +1 => bonus +5) vs fac_xungui (influence 40 -> +2, normal 13 => target 15).
  // Roll 16 + 5 = 21 >= 19 -> smooth!
  const smoothSession = run(
    'hold_court',
    world,
    {
      agenda: '推行江南清丈与摊丁入亩',
      domain: 'governance',
      lead_official_id: 'npc_chancellor',
      opposing_faction_id: 'fac_xungui',
      difficulty: 'normal',
      metric_changes: [
        { id: 'treasury', delta: 200 },
        { id: 'stability', delta: 40 },
      ],
    },
    faces(20, 16),
  );
  assert.equal(smoothSession.isError, false);
  assert.equal(smoothSession.report.outcome, 'smooth');
  assert.equal(world.modules.court?.sessionsHeld, 1);
  assert.equal(world.modules.court?.metrics.find((m) => m.id === 'treasury')?.value, 700);
  // Gauge clamped at max 100
  assert.equal(world.modules.court?.metrics.find((m) => m.id === 'stability')?.value, 100);
  assert.equal(world.modules.court?.officials.npc_chancellor?.influence, 77);
  assert.equal(world.modules.court?.factions.fac_xungui?.influence, 38);

  // hold_court backlash: general (governance 45 -> -1, loyalty 28 -> -2 => bonus -3) rolls 1 -> backlash!
  const backlashSession = run(
    'hold_court',
    world,
    {
      agenda: '强征关内民夫修筑塞堡',
      domain: 'governance',
      lead_official_id: 'npc_general',
      opposing_faction_id: 'fac_qingliu',
      difficulty: 'hard',
      metric_changes: [{ id: 'stability', delta: 20 }],
    },
    faces(20, 1),
  );
  assert.equal(backlashSession.isError, false);
  assert.equal(backlashSession.report.outcome, 'backlash');
  // Positive intended delta reverses on backlash (-round(20 * 0.35) = -7 -> 100 - 7 = 93).
  assert.equal(world.modules.court?.metrics.find((m) => m.id === 'stability')?.value, 93);

  // Actor talk isolation: chancellor sees his own office & loyalty, public memorials, and colleagues' posts,
  // but NEVER sees npc_general's loyalty (28) nor npc_general's secret memorial ("《北境密报疏》").
  const session = makeSession(world);
  const chancellorInit = buildActorInit(
    session,
    world.characters.npc_chancellor!,
    '林阁老以为清丈之策如何？',
    4,
    8,
    ['court'],
  );
  assert.match(chancellorInit.prompt, /<court_standing>/);
  assert.match(chancellorInit.prompt, /"your_office":\{"office":"内阁首辅"/);
  assert.doesNotMatch(chancellorInit.prompt, /"loyalty"/);
  assert.doesNotMatch(chancellorInit.prompt, /北境密报疏/);

  // Meanwhile npc_general IS the author of `mem_secret`, so he DOES see his own secret memorial.
  const generalInit = buildActorInit(
    session,
    world.characters.npc_general!,
    '北境军情如何？',
    4,
    8,
    ['court'],
  );
  assert.match(generalInit.prompt, /北境密报疏/);
});

// --- lineage -----------------------------------------------------------------

test('lineage: manages consorts, single heir apparent invariant, grand tutor bonuses, and nurture_heir outcomes', () => {
  const world = worldWithPalace();

  // Register chancellor in court so tutor bonus scales from his governance (90 -> +3).
  run('record', world, {
    court: {
      officials: [{ character_id: 'npc_chancellor', office: '内阁首辅', governance: 90, intrigue: 75, military: 30 }],
    },
    lineage: {
      house_name: '大乾萧氏宗室',
      succession_law: '有德者居东宫',
      consorts: [
        {
          character_id: 'npc_consort',
          title: '宸贵妃',
          rank_order: 2,
          palace: '长乐宫',
          favor: 85,
          family_background: '江南苏氏书香门第',
        },
      ],
      heirs: [
        {
          character_id: 'npc_prince1',
          order: '皇长子',
          title: '秦王',
          parent_ids: ['pc_emperor', 'npc_consort'],
          tutor_id: 'npc_chancellor',
          is_heir_apparent: true,
          aptitude: { governance: 55, martial: 40, virtue: 60, learning: 65 },
          backing: '清流文臣',
        },
        {
          character_id: 'npc_prince2',
          order: '皇次子',
          title: '晋王',
          aptitude: { governance: 40, martial: 70, virtue: 45, learning: 40 },
        },
      ],
      relatives: [
        {
          character_id: 'npc_uncle',
          relation: '皇叔',
          title: '宁亲王',
          influence: 72,
          note: '执掌宗人府',
        },
      ],
    },
    suggestions: ['考校皇嗣'],
  });

  assert.equal(world.modules.lineage?.heirs.npc_prince1?.isHeirApparent, true);
  assert.equal(world.modules.lineage?.heirs.npc_prince2?.isHeirApparent, false);

  // Designating prince2 as heir apparent automatically clears prince1's flag and emits `heir_designated`.
  const switchedCrown = run('record', world, {
    lineage: {
      heirs: [{ character_id: 'npc_prince2', title: '皇太子', is_heir_apparent: true }],
    },
    suggestions: ['颁诏天下'],
  });
  assert.equal(world.modules.lineage?.heirs.npc_prince1?.isHeirApparent, false);
  assert.equal(world.modules.lineage?.heirs.npc_prince2?.isHeirApparent, true);
  assert.deepEqual(switchedCrown.events, [
    {
      type: 'heir_designated',
      characterId: 'npc_prince2',
      characterName: '萧承泽',
      title: '皇太子',
    },
  ]);

  // nurture_heir breakthrough: prince1 has tutor npc_chancellor (governance 90 -> +3) + strict (+1) = +4 bonus.
  // 2d6 rolls 4 + 4 = 8; total 12 >= 11 -> breakthrough (+8 governance: 55 -> 63).
  const nurtured = run(
    'nurture_heir',
    world,
    { character_id: 'npc_prince1', focus: 'governance', intensity: 'strict' },
    faces(6, 4, 4),
  );
  assert.equal(nurtured.isError, false);
  assert.equal(nurtured.report.outcome, 'breakthrough');
  assert.equal(nurtured.report.bonus, 4);
  assert.equal(world.modules.lineage?.heirs.npc_prince1?.aptitude.governance, 63);

  // Harsh pushing on low dice (1 + 2 = 3 <= 4) triggers `resisted` and erodes virtue (-2: 45 -> 43).
  const resisted = run(
    'nurture_heir',
    world,
    { character_id: 'npc_prince2', focus: 'martial', intensity: 'harsh' },
    faces(6, 1, 2),
  );
  assert.equal(resisted.isError, false);
  assert.equal(resisted.report.outcome, 'resisted');
  assert.equal(world.modules.lineage?.heirs.npc_prince2?.aptitude.martial, 70);
  assert.equal(world.modules.lineage?.heirs.npc_prince2?.aptitude.virtue, 43);

  // Consort sees `royal_household` in talk turns.
  const session = makeSession(world);
  const consortInit = buildActorInit(session, world.characters.npc_consort!, '近日宫中可还安稳？', 4, 8, ['lineage']);
  assert.match(consortInit.prompt, /<royal_household>/);
  assert.match(consortInit.prompt, /宸贵妃/);
  assert.match(consortInit.prompt, /萧承泽/);
});

// --- domain ------------------------------------------------------------------

test('domain: tracks stockpiles and facilities, completes construction on develop_domain, and informs stewards', () => {
  const world = worldWithPalace();

  const setup = run('record', world, {
    court: {
      officials: [{ character_id: 'npc_chancellor', office: '内阁首辅', governance: 75 }],
    },
    domain: {
      name: '神都洛阳',
      tier: '九五帝京',
      location_id: 'loc_hall',
      resources: [
        { id: 'grain', name: '常平仓粮', amount: 1000, per_cycle: 200 },
        { id: 'upkeep', name: '禁军军饷', amount: 500, per_cycle: -50 },
      ],
      facilities: [
        {
          id: 'fac_canal',
          name: '通济渠漕仓',
          category: '农商',
          status: 'building',
          level: 0,
          max_level: 5,
          progress: 1,
          segments: 3,
          steward_id: 'npc_chancellor',
          output: '每季漕粮 +200',
        },
      ],
    },
    suggestions: ['巡视工坊'],
  });
  assert.equal(setup.isError, false);
  assert.ok(setup.events.some((e: WorldEvent) => e.type === 'facility_updated'));

  // develop_domain: steward governance 75 -> +3 bonus, effort_bonus +2 -> +5.
  // Roll 15 + 5 = 20 >= 18 -> bountiful (+2 segments: 1 + 2 = 3/3 -> completed! Level 0 -> 1, status -> operational, grain +300, upkeep -50).
  const cycle = run(
    'develop_domain',
    world,
    { facility_id: 'fac_canal', effort_bonus: 2 },
    faces(20, 15),
  );
  assert.equal(cycle.isError, false);
  assert.equal(cycle.report.outcome, 'bountiful');
  assert.equal(cycle.report.completed_facility, '通济渠漕仓');
  assert.equal(world.modules.domain?.facilities.fac_canal?.level, 1);
  assert.equal(world.modules.domain?.facilities.fac_canal?.status, 'operational');
  assert.equal(world.modules.domain?.facilities.fac_canal?.progress, 0);
  assert.equal(world.modules.domain?.resources.find((r) => r.id === 'grain')?.amount, 1300);
  assert.equal(world.modules.domain?.resources.find((r) => r.id === 'upkeep')?.amount, 450);

  // Steward sees `domain_post` in talk turns.
  const session = makeSession(world);
  const stewardInit = buildActorInit(session, world.characters.npc_chancellor!, '漕仓工程进展如何？', 4, 8, ['domain']);
  assert.match(stewardInit.prompt, /<domain_post>/);
  assert.match(stewardInit.prompt, /通济渠漕仓/);
});

// --- espionage ---------------------------------------------------------------

test('espionage: deploys spies, resolves covert operations, burns exposed agents, reveals dossiers, and never leaks to NPCs', () => {
  const world = worldWithPalace();

  const deployed = run('record', world, {
    espionage: {
      agency_name: '皇城司',
      network_power: 60,
      agents: [
        {
          id: 'spy_owl',
          codename: '夜枭',
          cover: '镇北侯府账房',
          target_id: 'npc_general',
          infiltration: 50,
          exposure: 7,
        },
      ],
      dossiers: [
        {
          id: 'dos_border',
          subject_id: 'npc_general',
          title: '《私贩边铁密账》',
          summary: '镇北侯长子暗中向塞外私售军铁。',
          leverage: '亲笔交割密信三封',
          verified: true,
          hidden: true,
        },
      ],
    },
    suggestions: ['密令皇城司'],
  });
  assert.equal(deployed.isError, false);
  // Hidden dossier is NOT announced yet; only spy_deployed is emitted.
  assert.deepEqual(deployed.events, [
    {
      type: 'spy_deployed',
      id: 'spy_owl',
      codename: '夜枭',
      targetName: '霍镇北',
      cover: '镇北侯府账房',
    },
  ]);

  // Triumph roll (d100 = 5): deepens infiltration (+18 -> 68) and cools exposure (-1 -> 6).
  const triumphOp = run(
    'run_operation',
    world,
    { agent_id: 'spy_owl', operation: 'wiretap', reason: '截获书房密信' },
    faces(100, 5),
  );
  assert.equal(triumphOp.isError, false);
  assert.equal(triumphOp.report.outcome, 'triumph');
  assert.equal(world.modules.espionage?.agents.spy_owl?.infiltration, 68);
  assert.equal(world.modules.espionage?.agents.spy_owl?.exposure, 6);

  // Reveal the uncovered dossier in `record.espionage`.
  const uncovered = run('record', world, {
    espionage: { dossiers: [{ id: 'dos_border', hidden: false }] },
    suggestions: ['审阅密档'],
  });
  assert.deepEqual(uncovered.events, [
    {
      type: 'dossier_acquired',
      id: 'dos_border',
      title: '《私贩边铁密账》',
      subjectName: '霍镇北',
      verified: true,
    },
  ]);

  // Critical blown roll (d100 = 99) when exposure is 6 -> +4 exposure = 10 -> agent becomes `compromised`!
  const blownOp = run(
    'run_operation',
    world,
    { agent_id: 'spy_owl', operation: 'raid', difficulty: 'hard', reason: '潜入暗格盗取虎符' },
    faces(100, 99),
  );
  assert.equal(blownOp.isError, false);
  assert.equal(blownOp.report.outcome, 'blown');
  assert.equal(blownOp.report.compromised, true);
  assert.equal(world.modules.espionage?.agents.spy_owl?.status, 'compromised');

  // A compromised agent cannot run further operations until extracted/reset.
  const refusedOp = run('run_operation', world, {
    agent_id: 'spy_owl',
    operation: 'recon',
    reason: '继续刺探',
  });
  assert.equal(refusedOp.isError, true);

  // STRICT NON-LEAKAGE: npc_general must NEVER see皇城司, 夜枭, or《私贩边铁密账》in his actor prompt!
  const session = makeSession(world);
  const targetInit = buildActorInit(session, world.characters.npc_general!, '爱卿府上近来可好？', 4, 8, [
    'espionage',
  ]);
  assert.doesNotMatch(targetInit.prompt, /espionage/);
  assert.doesNotMatch(targetInit.prompt, /皇城司/);
  assert.doesNotMatch(targetInit.prompt, /夜枭/);
  assert.doesNotMatch(targetInit.prompt, /私贩边铁密账/);
});

// --- progression -------------------------------------------------------------

test('progression: records realm ladder and techniques, and resolves breakthrough advancement vs qi-deviation backlash', () => {
  const world = worldWithPalace();

  const init = run('record', world, {
    progression: {
      system_name: '真龙紫气诀',
      ladder: ['炼气', '筑基', '金丹', '元婴'],
      realm: '炼气',
      sub_realm: '大圆满',
      xp: 100,
      xp_max: 100,
      bottleneck: '需引皇城龙脉紫气入体冲破玄关',
      deviation: 15,
      abilities: [
        {
          id: 'ab_dragon_qi',
          name: '太祖真龙劲',
          category: '帝王心法',
          rank: '大成',
          equipped: true,
          cost: '常驻护体',
          description: '以国运龙气淬炼经脉。',
        },
      ],
    },
    suggestions: ['闭关冲关'],
  });
  assert.equal(init.isError, false);
  assert.deepEqual(init.events, [
    {
      type: 'ability_learned',
      id: 'ab_dragon_qi',
      name: '太祖真龙劲',
      category: '帝王心法',
      rank: '大成',
    },
  ]);

  // Backlash roll (d100 = 99): fails violently, halves XP (100 -> 50), spikes deviation (+25: 15 -> 40), keeps realm.
  const failed = run(
    'breakthrough',
    world,
    {
      target_realm: '筑基',
      target_sub_realm: '初期',
      reason: '强行逆冲玄关',
    },
    faces(100, 99),
  );
  assert.equal(failed.isError, false);
  assert.equal(failed.report.outcome, 'backlash');
  assert.equal(world.modules.progression?.realm, '炼气');
  assert.equal(world.modules.progression?.xp, 50);
  assert.equal(world.modules.progression?.deviation, 40);

  // Refill XP via xp_delta and take a spirit pill (+25 catalyst_bonus), rolling d100 = 5 -> transcendent!
  run('record', world, {
    progression: { xp_delta: 60 },
    suggestions: ['服丹再破'],
  });
  assert.equal(world.modules.progression?.xp, 110);

  const ascended = run(
    'breakthrough',
    world,
    {
      target_realm: '筑基',
      target_sub_realm: '初期',
      catalyst_bonus: 25,
      reason: '服下九转筑基丹引龙脉冲关',
    },
    faces(100, 5),
  );
  assert.equal(ascended.isError, false);
  assert.equal(ascended.report.outcome, 'transcendent');
  assert.equal(world.modules.progression?.realm, '筑基');
  assert.equal(world.modules.progression?.subRealm, '初期');
  assert.equal(world.modules.progression?.xpMax, 150);
  // Transcendent carries 15% of previous xpMax (15) and cleanses 25 deviation (40 - 25 = 15) and bottleneck.
  assert.equal(world.modules.progression?.xp, 15);
  assert.equal(world.modules.progression?.deviation, 15);
  assert.equal(world.modules.progression?.bottleneck, '');
});
