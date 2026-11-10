import type { Locale } from '@roleplay/shared';
import type { ToolResult, TurnMeta } from './types';

/**
 * The mock's second story: three powers on a small map. It exists to show the
 * sandbox module working without a model: the board set up in the opening
 * record, battles and rounds handed to `simulate`, and the other side making
 * moves of its own.
 */

const PLAYER = 'pc_player';
const CHANCELLOR = 'npc_chancellor';
const ENVOY = 'npc_envoy';
const RIVAL_KING = 'npc_vesk_king';
const QUEST = 'quest_hold_the_border';

const AREN = 'f_aren';
const VESK = 'f_vesk';
const LEAGUE = 'f_league';

/** A premise that reads like powers contending over land is told with the board. */
export const BOARD_PREMISE = /\b(sandbox|kingdoms?|nations?|empires?|realms?|warlords?|conquest|conquer)\b|沙盘|三国|列国|王国|帝国|国家|争霸|天下|诸侯|势力|王朝/i;

// Vesk's lands, in the order the player's armies would reach them.
const VESK_REGIONS = ['r_ashford', 'r_iron_hills', 'r_vesk_hold'];

interface BoardText {
  title: string;
  premise: string;
  opening: string;
  seasons: string[];
  period(season: string, year: number): string;
  resources: { gold: string; grain: string; troops: string };
  authority: string;
  player: { name: string; role: string; description: string; status: string };
  chancellor: Record<string, string>;
  envoy: Record<string, string>;
  rivalKing: Record<string, string>;
  council: { name: string; description: string };
  rivalCourt: { name: string; description: string };
  factions: Record<string, { name: string; description: string; status: string }>;
  regions: Record<string, { name: string; terrain: string }>;
  notes: { arenVesk: string; arenLeague: string };
  quest: { title: string; description: string; progress: string };
  openingSummary: string;
  openingMemory: string;
  openingSuggestions: string[];
  attackWords: RegExp;
  battleReason(region: string): string;
  won(region: string, losses: number, theirs: number): string;
  lost(region: string, losses: number, theirs: number): string;
  quiet(period: string): string;
  rivalMove: string;
  rivalStatus: string;
  summary: { won: string; lost: string; quiet: string };
  progress: { won(region: string): string; lost: string; quiet: string };
  witnessed: { won(region: string): string; lost(region: string): string; quiet: string };
  suggestions: string[];
}

const en: BoardText = {
  title: 'Three Crowns',
  premise:
    'Three powers share one valley: the duchy of Aren, the kingdom of Vesk across the river, and the merchant League on the coast. You rule Aren as regent. (Demo story: a real model would build the board from your premise.)',
  opening: [
    'The map on the council table is older than you are, and the river drawn across it has moved twice since. Chancellor Marrow sets a lead soldier on Stonebridge and another, in Vesk\'s red, on Ashford just beyond it.',
    '"They raided the bridge again last night, my lord regent. Thirty spears, perhaps forty." She does not look up. "The League\'s envoy has been waiting an hour to ask what you mean to do about it."',
    'At the far end of the hall, the envoy studies a tapestry with the patience of a man who is paid by the day.',
  ].join('\n\n'),
  seasons: ['Spring', 'Summer', 'Autumn', 'Winter'],
  period: (season, year) => `${season}, year ${year}`,
  resources: { gold: 'Treasury', grain: 'Grain', troops: 'Troops' },
  authority: 'Authority',
  player: {
    name: 'Regent',
    role: 'Regent of Aren',
    description: 'Ruling in the name of a duke too young to rule, with a court that has not yet decided to obey.',
    status: 'At the council table',
  },
  chancellor: {
    name: 'Chancellor Ilse Marrow',
    role: 'Chancellor of Aren',
    description: 'Grey, exact, and thirty years at this table under three rulers.',
    personality: 'Cautious and dry; counts the cost of everything aloud.',
    status: 'Moving lead soldiers on the map',
    attitude: 'Loyal, and watching to see what you are made of',
    voice: 'Measured, numbers first. "We can afford one war, my lord. Not the one after it."',
    goals: 'Keep Aren solvent and its border where it is.',
    secrets: 'She has been corresponding with the League about a loan, without asking you.',
  },
  envoy: {
    name: 'Corvin Hale',
    role: 'Envoy of the League',
    description: 'Well dressed, well fed, and never in a hurry.',
    personality: 'Smooth, amused, loyal to whoever is winning.',
    status: 'Studying a tapestry, listening to everything',
    attitude: 'Courteous',
    voice: 'Silken and oblique. "The League has no enemies, my lord. Only customers who have not paid yet."',
    goals: 'Find out whether Aren or Vesk will win, and lend to that one.',
    secrets: 'The League sells grain to Vesk as well.',
  },
  rivalKing: {
    name: 'King Harald of Vesk',
    role: 'King of Vesk',
    description: 'A broad man gone grey early, who still leads his own vanguard.',
    personality: 'Proud, direct, patient when it pays.',
    status: 'Holding court at Veskhold',
    attitude: 'Contemptuous of a regent',
    voice: 'Blunt, short. "A river is not a border. It is a road."',
    goals: 'Take Stonebridge and with it the valley road.',
    secrets: 'His treasury cannot bear a long war.',
  },
  council: { name: 'Council Hall', description: 'The long hall of Aren Keep. The map table stands under the tall north windows.' },
  rivalCourt: { name: 'Court of Veskhold', description: 'A smoky hall of black timber, across the river and two days\' ride east.' },
  factions: {
    [AREN]: { name: 'Duchy of Aren', description: 'A farming duchy with a strong keep and a thin purse.', status: 'Raided at the border, undecided' },
    [VESK]: { name: 'Kingdom of Vesk', description: 'A warlike kingdom of hill forts and iron mines.', status: 'Testing the border' },
    [LEAGUE]: { name: 'Merchant League', description: 'Coastal trading cities that fight with coin first.', status: 'Watching, counting' },
  },
  regions: {
    r_aren_keep: { name: 'Aren Keep', terrain: 'fortress' },
    r_greenfields: { name: 'Greenfields', terrain: 'farmland' },
    r_stonebridge: { name: 'Stonebridge', terrain: 'river crossing' },
    r_fens: { name: 'The Fens', terrain: 'marsh' },
    r_ashford: { name: 'Ashford', terrain: 'ford' },
    r_iron_hills: { name: 'Iron Hills', terrain: 'hills' },
    r_vesk_hold: { name: 'Veskhold', terrain: 'hill fort' },
    r_port_mera: { name: 'Port Mera', terrain: 'port' },
    r_salt_isles: { name: 'Salt Isles', terrain: 'islands' },
  },
  notes: { arenVesk: 'Raids at Stonebridge all spring.', arenLeague: 'Grain-for-salt treaty, renewed yearly.' },
  quest: {
    title: 'Hold the Border',
    description: 'Vesk is probing Stonebridge. Decide how Aren answers before the raids become a war.',
    progress: 'The council is waiting on you.',
  },
  openingSummary: 'The council waits for your answer to the raids.',
  openingMemory:
    'I showed the regent the raid on Stonebridge on the map table: thirty or forty Vesk spears, the night before. The League envoy was kept waiting. I am watching what the regent does with it.',
  openingSuggestions: ['March on Ashford', 'Ask the chancellor what a war would cost', 'Hear the League envoy out'],
  attackWords: /attack|march|strike|assault|invade|take |war/i,
  battleReason: (region) => `Aren's host marches on ${region}`,
  won: (region, losses, theirs) =>
    [
      `The host crosses at dawn, and by noon the red banners over ${region} are down. It costs you ${losses} men; Vesk leaves ${theirs} on the field and the rest in the river.`,
      'Chancellor Marrow moves the lead soldier across the map herself. "One war, my lord," she says. "We have now started it."',
    ].join('\n\n'),
  lost: (region, losses, theirs) =>
    [
      `${region} does not fall. The ford runs high, Vesk's spears hold the far bank, and your host comes back ${losses} men short for the ${theirs} it killed.`,
      '"They will come for Stonebridge now," the chancellor says, and takes one lead soldier off the table.',
    ].join('\n\n'),
  quiet: (period) =>
    [
      `${period}. The season turns without a battle. Grain comes in from Greenfields, the treasury fills a little, and the patrols at Stonebridge report campfires across the river, more each week.`,
      '"They are not waiting for our permission," Chancellor Marrow says.',
    ].join('\n\n'),
  rivalMove: 'Vesk calls up its hill levies.',
  rivalStatus: 'Mustering at Veskhold',
  summary: { won: 'You have taken land from Vesk. It is war now.', lost: 'The attack failed. Vesk will answer.', quiet: 'A season has passed. Vesk is mustering.' },
  progress: {
    won: (region) => `${region} is yours. Vesk will want it back.`,
    lost: 'Your attack was thrown back. The border is weaker for it.',
    quiet: 'A season gone, the border still holds.',
  },
  witnessed: {
    won: (region) => `The regent ordered the host against ${region} and it fell. I moved the piece myself. Now we are at war with Vesk, and I must find the coin for it.`,
    lost: (region) => `The regent ordered the host against ${region} and it was thrown back. Men lost for nothing. I said one war; we may not get to choose it now.`,
    quiet: 'The regent let the season pass without marching. The stores grew. Vesk grew faster.',
  },
  suggestions: ['March on the next Vesk holding', 'Send the envoy to Vesk with terms', 'Wait out another season'],
};

const zh: BoardText = {
  title: '三冠之谷',
  premise:
    '一条河谷，三方势力：种田的岚国，对岸尚武的朔国，以及海边的澜海商盟。你是岚国的摄政。（演示剧本：接入真实模型后，沙盘会按你的设定生成。）',
  opening: [
    '议事厅长桌上的那张地图比你的年纪还大，图上那条河已经改过两次道。丞相沈砚把一枚铅兵放在石桥关上，又把一枚朔国的红色铅兵放在关外的灰渡。',
    '“昨夜他们又来袭扰石桥关，摄政大人。三十杆枪，也许四十。”她没有抬头，“商盟的使者已经等了一个时辰，想问您打算怎么办。”',
    '大厅那一头，使者正端详着一幅挂毯，一副按日领薪、不慌不忙的样子。',
  ].join('\n\n'),
  seasons: ['春', '夏', '秋', '冬'],
  period: (season, year) => `${year === 1 ? '元' : year}年·${season}`,
  resources: { gold: '国库', grain: '粮草', troops: '兵力' },
  authority: '威望',
  player: {
    name: '摄政',
    role: '岚国摄政',
    description: '替年幼的国君执政，而朝堂上下还没拿定主意要不要听你的。',
    status: '坐在议事桌前',
  },
  chancellor: {
    name: '沈砚',
    role: '岚国丞相',
    description: '头发花白，一丝不苟，在这张桌边辅佐过三代国君。',
    personality: '谨慎，话不多；凡事先把代价算给人听。',
    status: '在地图上挪动铅兵',
    attitude: '忠心，也在看你是什么成色',
    voice: '不紧不慢，先报数目。“一场仗，我们打得起，大人。再多一场，就打不起了。”',
    goals: '保住岚国的钱粮，守住现在的边界。',
    secrets: '她瞒着你，一直在和商盟通信商量借款。',
  },
  envoy: {
    name: '贺澜',
    role: '商盟使者',
    description: '衣着讲究，面色红润，从不着急。',
    personality: '圆滑，带点看戏的意思，谁赢就向着谁。',
    status: '端详挂毯，耳朵却没闲着',
    attitude: '客客气气',
    voice: '绵里藏针，绕着弯说话。“商盟没有敌人，大人。只有还没结账的主顾。”',
    goals: '看清岚国和朔国谁会赢，然后把钱借给那一方。',
    secrets: '商盟同时也在向朔国卖粮。',
  },
  rivalKing: {
    name: '拓跋弘',
    role: '朔国国君',
    description: '身形魁梧，早生华发，至今仍亲率前锋。',
    personality: '高傲，直来直去，有利可图时也沉得住气。',
    status: '在朔城升帐议事',
    attitude: '瞧不上一个摄政',
    voice: '话短而硬。“河不是界，河是路。”',
    goals: '拿下石桥关，连同整条谷道。',
    secrets: '他的国库撑不起一场久战。',
  },
  council: { name: '议事厅', description: '岚都城堡的长厅。地图桌摆在北面的高窗下。' },
  rivalCourt: { name: '朔城大帐', description: '乌木搭的大厅，烟气熏人，在河对岸往东两天马程。' },
  factions: {
    [AREN]: { name: '岚国', description: '以农立国，城堡坚固，国库单薄。', status: '边境遭袭，尚未表态' },
    [VESK]: { name: '朔国', description: '山寨与铁矿之国，民风尚武。', status: '试探边境' },
    [LEAGUE]: { name: '澜海商盟', description: '沿海的商贸城邦，打仗先拿钱开路。', status: '旁观，算账' },
  },
  regions: {
    r_aren_keep: { name: '岚都', terrain: '城堡' },
    r_greenfields: { name: '青禾原', terrain: '农田' },
    r_stonebridge: { name: '石桥关', terrain: '渡口关隘' },
    r_fens: { name: '雾泽', terrain: '沼泽' },
    r_ashford: { name: '灰渡', terrain: '浅滩' },
    r_iron_hills: { name: '铁岭', terrain: '丘陵' },
    r_vesk_hold: { name: '朔城', terrain: '山寨' },
    r_port_mera: { name: '澜港', terrain: '港口' },
    r_salt_isles: { name: '盐屿', terrain: '群岛' },
  },
  notes: { arenVesk: '整个春天，石桥关袭扰不断。', arenLeague: '以粮换盐之约，一年一续。' },
  quest: {
    title: '守住边界',
    description: '朔国正在试探石桥关。趁袭扰还没变成战争，决定岚国如何应对。',
    progress: '朝堂在等你拿主意。',
  },
  openingSummary: '朝堂在等你对边境袭扰的答复。',
  openingMemory: '我在地图桌上向摄政禀报了石桥关遇袭的事：前一夜，朔国三四十杆枪。商盟使者被晾在一边等着。我在看摄政怎么处置。',
  openingSuggestions: ['出兵攻打灰渡', '问丞相打一仗要花多少', '听听商盟使者怎么说'],
  attackWords: /进攻|攻打|出兵|讨伐|夺|开战|发兵/,
  battleReason: (region) => `岚国大军进攻${region}`,
  won: (region, losses, theirs) =>
    [
      `大军拂晓渡河，到正午，${region}城头的红旗已经落了。你折了 ${losses} 人；朔国在战场上丢下 ${theirs} 人，其余的被赶进了河里。`,
      '丞相沈砚亲手把那枚铅兵挪过了河。“一场仗，大人。”她说，“现在我们把它打起来了。”',
    ].join('\n\n'),
  lost: (region, losses, theirs) =>
    [
      `${region}没有拿下。河水正涨，朔国的长枪守住了对岸，你的大军折损 ${losses} 人退了回来，只换掉对方 ${theirs} 人。`,
      '“接下来他们就该来打石桥关了。”丞相说着，从桌上拿走了一枚铅兵。',
    ].join('\n\n'),
  quiet: (period) =>
    [
      `${period}。这一季没有打仗。青禾原的粮食入了仓，国库宽裕了些，石桥关的巡哨回报说，河对岸的营火一个礼拜比一个礼拜多。`,
      '“他们可不会等我们点头。”丞相沈砚说。',
    ].join('\n\n'),
  rivalMove: '朔国征调山地各寨的兵丁。',
  rivalStatus: '在朔城集结',
  summary: { won: '你从朔国手里夺下了土地。这下是开战了。', lost: '进攻失利。朔国必有回应。', quiet: '一季过去。朔国正在集结。' },
  progress: {
    won: (region) => `${region}已归你所有。朔国不会善罢甘休。`,
    lost: '你的进攻被打了回来，边境反而更虚了。',
    quiet: '又过了一季，边界还在。',
  },
  witnessed: {
    won: (region) => `摄政下令大军进攻${region}，拿下来了。是我亲手挪的棋子。如今我们和朔国开战了，军费得由我去筹。`,
    lost: (region) => `摄政下令大军进攻${region}，被打了回来。白白折了人马。我说过只打得起一场仗；现在怕是由不得我们挑了。`,
    quiet: '摄政让这一季平平过去，没有出兵。仓里的粮多了。朔国的兵多得更快。',
  },
  suggestions: ['进攻朔国的下一处领地', '派使者去朔国谈条件', '再等一季'],
};

const TEXTS: Record<Locale, BoardText> = { en, zh };

// Where each region lies on the map grid, who holds it and what it borders.
const MAP: { id: string; owner: string | null; x: number; y: number; neighbors: string[]; strength?: number }[] = [
  { id: 'r_aren_keep', owner: AREN, x: 2, y: 3, neighbors: ['r_greenfields', 'r_stonebridge'], strength: 3 },
  { id: 'r_greenfields', owner: AREN, x: 3, y: 5, neighbors: ['r_stonebridge', 'r_port_mera'] },
  { id: 'r_stonebridge', owner: AREN, x: 4, y: 3, neighbors: ['r_ashford', 'r_fens'], strength: 2 },
  { id: 'r_fens', owner: null, x: 5, y: 1, neighbors: ['r_ashford'] },
  { id: 'r_ashford', owner: VESK, x: 6, y: 3, neighbors: ['r_vesk_hold', 'r_iron_hills'], strength: 1 },
  { id: 'r_iron_hills', owner: VESK, x: 7, y: 5, neighbors: ['r_vesk_hold', 'r_port_mera'], strength: 2 },
  { id: 'r_vesk_hold', owner: VESK, x: 8, y: 2, neighbors: [], strength: 4 },
  { id: 'r_port_mera', owner: LEAGUE, x: 5, y: 6, neighbors: ['r_salt_isles'], strength: 2 },
  { id: 'r_salt_isles', owner: LEAGUE, x: 7, y: 7, neighbors: [] },
];

function periodFor(text: BoardText, round: number): string {
  return text.period(text.seasons[round % text.seasons.length] ?? '', 1 + Math.floor(round / text.seasons.length));
}

/** The opening: a council scene, and the whole board in one record. */
export function openBoard(
  meta: TurnMeta,
  story: { has(id: string): boolean; choosing: boolean; offered: string[] },
): { text: string; record: Record<string, unknown> } {
  const text = TEXTS[meta.locale];
  const holdings = (gold: number, grain: number, troops: number) => [
    { id: 'gold', value: gold },
    { id: 'grain', value: grain },
    { id: 'troops', value: troops },
  ];
  return {
    text: text.opening,
    record: {
      world: { title: text.title, premise: text.premise },
      locations: [
        { id: 'loc_council', ...text.council },
        { id: 'loc_vesk_court', ...text.rivalCourt },
      ],
      characters: [
        {
          id: PLAYER,
          ...text.player,
          name: meta.seed.playerName || text.player.name,
          is_player: true,
          location_id: 'loc_council',
          stats: [{ name: text.authority, value: 2 }],
        },
        { id: CHANCELLOR, ...text.chancellor, location_id: 'loc_council' },
        { id: ENVOY, ...text.envoy, location_id: 'loc_council' },
        { id: RIVAL_KING, ...text.rivalKing, location_id: 'loc_vesk_court' },
      ],
      quests: [{ id: QUEST, ...text.quest }],
      scene: { location_id: 'loc_council', time: periodFor(text, 0), summary: text.openingSummary },
      memories: [{ character_id: CHANCELLOR, text: text.openingMemory, about: [PLAYER], importance: 3 }],
      ...(story.has('dice') ? { dice: { system: 'd20' } } : {}),
      // A story of contending powers keeps the board, and whatever else it was offered.
      ...(story.choosing ? { modules: story.offered } : {}),
      sandbox: {
        period: periodFor(text, 0),
        resources: [
          { id: 'gold', name: text.resources.gold },
          { id: 'grain', name: text.resources.grain },
          { id: 'troops', name: text.resources.troops },
        ],
        factions: [
          { id: AREN, ...text.factions[AREN], is_player: true, leader_id: PLAYER, resources: holdings(120, 200, 60), income: holdings(20, 30, 5) },
          { id: VESK, ...text.factions[VESK], leader_id: RIVAL_KING, resources: holdings(150, 180, 90), income: holdings(25, 20, 8) },
          { id: LEAGUE, ...text.factions[LEAGUE], leader_id: ENVOY, resources: holdings(300, 120, 40), income: holdings(40, 10, 3) },
        ],
        regions: MAP.map(({ id, owner, ...place }) => ({ id, ...text.regions[id], owner_id: owner, ...place })),
        relations: [
          { a: AREN, b: VESK, stance: 'hostile', note: text.notes.arenVesk },
          { a: AREN, b: LEAGUE, stance: 'friendly', note: text.notes.arenLeague },
        ],
      },
      suggestions: text.openingSuggestions,
    },
  };
}

/** First step of a turn on the board: hand the season, and any battle the player ordered, to `simulate`. */
export function boardOrders(meta: TurnMeta): Record<string, unknown> {
  const text = TEXTS[meta.locale];
  const board = meta.world.modules.sandbox;
  const advance = { period: periodFor(text, (board?.round ?? 0) + 1) };
  const target = VESK_REGIONS.find((id) => board?.regions[id]?.ownerId === VESK);
  if (!target || !text.attackWords.test(meta.playerText)) return { advance };
  return {
    battles: [
      {
        attacker_id: AREN,
        defender_id: VESK,
        region_id: target,
        attacker_force: 40,
        defender_force: 30,
        defender_edge: 1,
        losses_from: 'troops',
        reason: text.battleReason(text.regions[target]?.name ?? target),
      },
    ],
    advance,
  };
}

interface SimulateReport {
  battles?: { region?: string; winner?: string; losses?: { attacker?: number; defender?: number } }[];
  round?: { period?: string };
}

/**
 * Second step: tell how it came out, and record what the other side does about
 * it. `sandbox` is false when the module has been switched off, which leaves a
 * quiet season to tell and no board to write to.
 */
export function boardOutcome(
  meta: TurnMeta,
  results: ToolResult[],
  sandbox: boolean,
): { text: string; record: Record<string, unknown> } {
  const text = TEXTS[meta.locale];
  let report: SimulateReport = {};
  try {
    report = JSON.parse(results[0]?.content ?? '{}') as SimulateReport;
  } catch {
    // An unreadable result is told as a quiet season.
  }
  const battle = report.battles?.[0];
  const period = report.round?.period ?? meta.world.scene.time;
  const region = battle?.region ? (text.regions[battle.region]?.name ?? battle.region) : '';
  const outcome = !battle ? 'quiet' : battle.winner === 'attacker' ? 'won' : 'lost';
  const ours = battle?.losses?.attacker ?? 0;
  const theirs = battle?.losses?.defender ?? 0;

  const told = { won: text.won(region, ours, theirs), lost: text.lost(region, ours, theirs), quiet: text.quiet(period) }[outcome];
  const witnessed = { won: text.witnessed.won(region), lost: text.witnessed.lost(region), quiet: text.witnessed.quiet }[outcome];
  const progress = { won: text.progress.won(region), lost: text.progress.lost, quiet: text.progress.quiet }[outcome];

  return {
    text: `${told}\n\n${text.rivalMove}`,
    record: {
      quests: [{ id: QUEST, progress }],
      scene: { time: period, summary: text.summary[outcome] },
      memories: [{ character_id: CHANCELLOR, text: witnessed, about: [PLAYER], importance: battle ? 4 : 2 }],
      ...(sandbox
        ? {
            sandbox: {
              // The other side is not waiting for the player.
              factions: [{ id: VESK, status: text.rivalStatus, resources: [{ id: 'troops', change: 10 }] }],
              ...(battle ? { relations: [{ a: AREN, b: VESK, stance: 'war' }] } : {}),
            },
          }
        : {}),
      suggestions: text.suggestions,
    },
  };
}
