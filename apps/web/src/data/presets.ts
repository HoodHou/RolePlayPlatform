import type { Locale, ModuleId } from '@roleplay/shared';

export const SCENARIO_CATEGORIES = ['all', 'imperial', 'xianxia', 'intrigue', 'worlds'] as const;
export type ScenarioCategory = (typeof SCENARIO_CATEGORIES)[number];

export const PRESET_IDS = [
  'imperial_dawn',
  'imperial_crisis',
  'immortal_dynasty',
  'regent_shadow',
  'xianxia',
  'jianghu_alliance',
  'brocade_guard',
  'mystery',
  'cyberpunk',
  'fantasy',
  'horror',
] as const;

export type PresetId = (typeof PRESET_IDS)[number];

export interface ScenarioPreset {
  id: PresetId;
  category: Exclude<ScenarioCategory, 'all'>;
  glyph: string;
  title: Record<Locale, string>;
  tagline: Record<Locale, string>;
  premise: Record<Locale, string>;
  playerName: Record<Locale, string>;
  playerConcept: Record<Locale, string>;
  modules: readonly ModuleId[];
}

export const SCENARIO_PRESETS: readonly ScenarioPreset[] = [
  {
    id: 'imperial_dawn',
    category: 'imperial',
    glyph: '冕',
    title: {
      zh: '九重惊雷 · 新帝亲政',
      en: 'Thunder in the Nine Courts',
    },
    tagline: {
      zh: '先帝狩猎暴崩，清流与勋贵撕裂朝堂，边关八百里加急雪夜抵京。',
      en: 'A sudden succession, a fractured court of scholars and dukes, and urgent northern beacons at dawn.',
    },
    premise: {
      zh: '大乾永宁元年冬，先帝于秋狝途中暴崩，留下一座暗流汹涌的万里江山。国库岁入因江南豪强兼并隐田而日渐空虚；内阁首辅林相如领衔的「清流党」力主清丈变法，而镇北侯霍镇北为首的「开国勋贵」死保世袭兵权与边饷；慈宁宫皇太后苏氏仍握着半枚监国凤印，后宫世家妃嫔亦各有外朝奥援。\n\n五更景阳钟响，风雪覆满太和殿丹墀。你身披十二章玄金龙袍初登九五宝座，御案上摆着江南亏空、北境异动与立后册封三道烫手奏折，而暗掌皇城司的心腹指挥使已在廊下静候密旨。',
      en: 'Winter of the first year of a fragile reign. The late Emperor died suddenly on the autumn hunt, leaving an exhausted treasury, a Grand Secretariat split between Chancellor Lin’s reformist scholars and Marquis Huo’s entrenched border dukes, and the Empress Dowager still holding half of the Privy Seal.\n\nDawn bells echo across snow-draped marble courtyards as ministers file into the Hall of Supreme Harmony. Three explosive memorials await your vermilion rescript on the Dragon Throne, while your secret-police commander waits quietly in the side gallery.',
    },
    playerName: { zh: '萧景琰', en: 'Aurelian Vale' },
    playerConcept: {
      zh: '年方十九的新登基天子，表面谦冲温润，实则城府深沉，暗握皇城司密探，决意借变法与考成收回乾纲',
      en: 'A nineteen-year-old newly crowned monarch—gracious in public, calculating in private, determined to reclaim full imperial authority',
    },
    modules: ['court', 'lineage', 'domain', 'espionage', 'bonds', 'calendar', 'reputation', 'clocks'],
  },
  {
    id: 'imperial_crisis',
    category: 'imperial',
    glyph: '鼎',
    title: {
      zh: '山河重铸 · 末世天子',
      en: 'Reforging a Falling Dynasty',
    },
    tagline: {
      zh: '国库见底、流民四起、关外铁骑压境，满朝文武各怀退路的绝境翻盘局。',
      en: 'An empty treasury, famine rebellions, and encroaching cavalry—save a dynasty on the brink.',
    },
    premise: {
      zh: '大虞崇明十七年，连年大旱与辽东战事已将两百年国祚拖入悬崖边缘：太仓存银不足十万两，陕西流民揭竿而起逼近潼关，关外黑水铁骑陈兵山海关外，而满朝勋戚巨贾却仍在私囤漕粮、暗中转移家产。\n\n昨夜司礼监掌印太监畏罪自缢，留下一册记满朝臣贪墨黑料的《癸未密录》。今晨早朝，户部与兵部同时跪请拨饷——你是效仿亡国之君坐困愁城，还是挥动诏狱屠刀、推行铁血新政逆天改命？',
      en: 'Seventeenth year of a dying golden age. Years of drought and frontier war have drained the imperial vaults below a hundred thousand taels. Rebel hosts march toward the central passes, northern steppe cavalry mass beyond the Great Wall, and wealthy court magnates quietly hoard grain while hedging their loyalties.\n\nLast night the Chief Eunuch died in his chambers, leaving behind a secret ledger of ministerial graft. At dawn council, both War and Revenue kneel demanding silver you do not have.',
    },
    playerName: { zh: '朱承钧', en: 'Cassian Vane' },
    playerConcept: {
      zh: '危局继位的铁腕君主，手握一册百官黑账与三千亲军禁卫，誓在倾覆前夜重铸万里河山',
      en: 'A steel-willed sovereign inheriting a collapsing realm, armed with a secret ledger of court corruption and three thousand loyal guards',
    },
    modules: ['court', 'domain', 'espionage', 'sandbox', 'clocks', 'calendar', 'reputation', 'dice'],
  },
  {
    id: 'immortal_dynasty',
    category: 'imperial',
    glyph: '龙',
    title: {
      zh: '气运金龙 · 仙朝女帝',
      en: 'Dragon-Vein Immortal Empress',
    },
    tagline: {
      zh: '皇权与修真并存的无上仙朝，聚九州社稷香火淬炼帝道金丹。',
      en: 'Rule an immortal dynasty where imperial statecraft feeds dragon-vein cultivation.',
    },
    premise: {
      zh: '大周神朝以武道真龙镇压九州仙门，历代帝王皆以江山社稷气运修行《人皇紫气诀》：朝政清明、万民归心则龙脉鼎盛助破大境；反之若藩镇割据、权臣乱政，则气运反噬心魔丛生。\n\n你以先帝遗诏登基为大周首任女皇，修为正处于筑基大圆满冲击金丹的瓶颈。朝堂之上，三大修真世家与太一仙宗使者借万寿朝贺之名试探皇权虚实；内廷之中，出身将门与世家的皇夫贵君亦牵动各方气运博弈。',
      en: 'In the Great Zhou Immortal Dynasty, the sovereign’s cultivation is bound directly to the Dragon Vein of the realm: prosperous governance and loyal ministers condense golden providence, while rebellion and corruption breed inner deviation.\n\nCrowned as the dynasty’s first reigning Empress at the peak of Foundation Establishment, you face immortal sect envoys testing your throne at the Grand Audience while noble consorts and court ministers vie for favor.',
    },
    playerName: { zh: '武明空', en: 'Empress Lingxiao' },
    playerConcept: {
      zh: '执掌大周仙朝的少年女皇，霸道果决，兼修帝王权术与真龙紫气，欲压服天下仙门证道人皇',
      en: 'First reigning Empress of an immortal dynasty, balancing court factions, noble consorts, and her impending Golden Core tribulation',
    },
    modules: ['court', 'lineage', 'progression', 'domain', 'espionage', 'bonds', 'combat'],
  },
  {
    id: 'regent_shadow',
    category: 'imperial',
    glyph: '印',
    title: {
      zh: '幼主权臣 · 摄政监国',
      en: 'The Iron Regent',
    },
    tagline: {
      zh: '八岁幼帝啼哭于冕旒之后，你以摄政王之尊总揽百官，辅政或代立一念之间。',
      en: 'An eight-year-old boy sits on the throne; as Lord Regent, will you guard his crown or claim it?',
    },
    premise: {
      zh: '白帝城托孤之夜，先兄紧握你的手将八岁幼主与半壁虎符交付于你，册封你为「摄政定国亲王」，入朝剑履上殿、赞拜不名。然而宫中年轻的皇太后暗联外戚国舅意图夺回政柄，帝师太傅率领清流言官日夜弹劾你功高震主，三镇节度使则在边关拥兵观望。\n\n今日是你主持的第一次大朝会，幼帝坐在珠帘微晃的宝座上频频回头望向你的脸色，阶下百官屏息等待摄政王的第一道钧旨。',
      en: 'On his deathbed, your royal brother placed the eight-year-old boy-Emperor and the Tiger Tally into your hands, naming you Prince Regent. Yet inside the palace the young Empress Dowager conspires with her maternal clan, the Grand Tutor rallies censorate scholars against your unchecked clout, and three frontier marshals watch for weakness.\n\nToday is your first Grand Council: the child monarch glances nervously toward you from the throne as every minister awaits your word.',
    },
    playerName: { zh: '萧玄溟', en: 'Doranayne Vale' },
    playerConcept: {
      zh: '战功赫赫、执掌京营与密探的摄政皇叔，立于忠臣周公与枭雄霸主的分水岭之上',
      en: 'Battle-tested Prince Regent commanding the capital garrison, walking the razor’s edge between loyal guardian and usurper',
    },
    modules: ['court', 'lineage', 'espionage', 'reputation', 'bonds', 'clocks', 'sandbox'],
  },
  {
    id: 'xianxia',
    category: 'xianxia',
    glyph: '剑',
    title: {
      zh: '云巅仙宗 · 祖脉重开',
      en: 'Cloud-Peak Sect: Spirit Vein',
    },
    tagline: {
      zh: '百年试炼将至，凋零仙门山底尘封灵脉复苏，执掌门铁剑重振山门、渡劫飞升。',
      en: 'Rebuild a faded immortal sect on the eve of its centennial trial as ancient spirit veins awaken.',
    },
    premise: {
      zh: '昔日名震东洲的青云剑宗日渐凋零：护山大阵残缺不全，灵田丹房入不敷出，邻近的黑煞宗与天剑阁正虎视眈眈欲在三月后的百年升仙试炼上瓜分青云地界。然而就在昨夜子时，后山思过崖底尘封已久的太古祖脉忽然震动，溢出一缕精纯先天灵气。\n\n你以新任少掌门之身召集残存长老与真传弟子于问剑殿：既要统筹灵石工坊重修山门大阵，又要化解执法堂的内讧，并在强敌叩关前冲破自身的修为瓶颈。',
      en: 'Cloud-ringed peaks of the once-great Azure Cloud Sword Sect stand half-ruined: the grand ward array is cracked, spirit-stone coffers run thin, and rival sects circle ahead of the centennial trial three months away. Yet at midnight, long-sealed primordial spirit veins stirred beneath the ancestral cliff.\n\nAs newly invested Young Patriarch, you gather the remaining elders and inner disciples to rebuild the mountain gate, quell internal dissent, and shatter your cultivation bottleneck.',
    },
    playerName: { zh: '沈青崖', en: 'Shen Qingya' },
    playerConcept: {
      zh: '临危受命的青云少掌门，剑心通明、身怀残缺古剑诀，肩负宗门兴衰与金丹大道',
      en: 'Newly appointed Young Patriarch gifted with sword-heart clarity and an ancient incomplete manual, carrying the sect’s survival',
    },
    modules: ['progression', 'domain', 'combat', 'dice', 'market', 'bonds', 'calendar', 'reputation'],
  },
  {
    id: 'jianghu_alliance',
    category: 'xianxia',
    glyph: '侠',
    title: {
      zh: '风雪孤城 · 武林金令',
      en: 'Frostbound Martial Alliance',
    },
    tagline: {
      zh: '武林盟主暴毙风雪驿馆，七大门派齐聚雁门孤城，刀光剑影间追查罗刹秘谱。',
      en: 'Seven martial sects snowbound in a border fortress after the Alliance Master falls dead.',
    },
    premise: {
      zh: '腊月塞外暴雪封山，统率中原正道的武林盟主在雁门关外「风陵渡客栈」暴毙，胸口留着失传二十年的魔教绝学「天罗血印」，随身携带的盟主金令与半卷《山河武库图》不知所踪。\n\n客栈内外已被少林、武当、唐门、峨眉与塞北刀客围得水泄不通，朝廷六扇门捕头亦隐身其中。所有人都在寻找凶手与秘图，而风雪至少还要封路五日。',
      en: 'A howling blizzard seals Wind-Crossing Inn outside Yanmen Pass on the very night the Martial Alliance Master is found dead—marked by a demonic palm technique thought extinct for twenty years, his golden tally and treasury map missing.\n\nMasters of seven orthodox and unorthodox sects are trapped under one roof alongside disguised imperial constables, with five days until the mountain pass clears.',
    },
    playerName: { zh: '谢无衣', en: 'Xie Wuyi' },
    playerConcept: {
      zh: '盟主膝下最年轻的关门弟子，轻功绝顶、剑术凌厉，背负清理门户与查明恩师死因的重任',
      en: 'The late Alliance Master’s youngest prodigy disciple—swift-footed and sharp-bladed, sworn to uncover the killer among the sects',
    },
    modules: ['progression', 'combat', 'clues', 'dice', 'bonds', 'reputation', 'clocks'],
  },
  {
    id: 'brocade_guard',
    category: 'intrigue',
    glyph: '卫',
    title: {
      zh: '锦衣暗夜 · 京畿迷局',
      en: 'Brocade Shadow: Capital Conspiracy',
    },
    tagline: {
      zh: '户部侍郎雪夜死于反锁书房，半页焚毁盐账牵出内阁与藩王惊天逆案。',
      en: 'Command imperial secret operatives to unravel a locked-room murder and a treasonous salt ledger.',
    },
    premise: {
      zh: '京师宣武门大街寒夜寂寥，主管两淮盐课核查的户部侍郎死于自家反锁的内书房，现场铜盆余烬里仅存半页染血暗账，隐约牵涉江南织造、内阁重臣与镇南藩王私运军械之嫌。\n\n你奉天子手诏执掌北镇抚司专案，调遣潜伏于六部与权贵府邸的暗桩密探，必须在十五日后的元宵大朝会前起获真凭实据。一步踏错，便是满门抄斩或打草惊蛇之祸。',
      en: 'On a freezing night in the imperial capital, the Vice Minister of Revenue is found dead inside his bolted study. Half a charred ledger in the brazier hints at illicit salt silver funneling weapons to a southern feudatory prince with high court backing.\n\nHolding a secret imperial warrant as Commander of the Northern鎮抚司, you have fifteen days before the Lantern Festival Grand Assembly to deploy spies, seize ironclad proof, and expose the conspirators.',
    },
    playerName: { zh: '陆沉舟', en: 'Lu Chenzhou' },
    playerConcept: {
      zh: '北镇抚司新晋千户，绣春刀快、心思缜密，执掌暗桩密网在朝堂巨鳄之间孤身破局',
      en: 'Newly promoted Brocade Guard commander—razor-sharp investigator wielding a covert informant network against court titans',
    },
    modules: ['espionage', 'clues', 'combat', 'dice', 'reputation', 'clocks', 'bonds', 'calendar'],
  },
  {
    id: 'mystery',
    category: 'intrigue',
    glyph: '钥',
    title: {
      zh: '暴雪孤庄 · 密室失踪',
      en: 'Cliffside Manor: The Locked Study',
    },
    tagline: {
      zh: '秋夜风暴断绝最后一班渡轮，悬崖庄园与世隔绝，主人从反锁书房离奇消失。',
      en: 'Cut off by an autumn gale, an island manor’s host vanishes from a study locked from within.',
    },
    premise: {
      zh: '深秋暴风雨掀翻了海域航标，最后一班渡轮停航，矗立在黑礁孤岛上的钟表巨擘庄园彻底与陆地失联。晚宴钟声敲响前，庄园主本要当众宣读更改后的遗嘱，众人撞开从内部反锁的顶楼书房时，屋中却空无一人，壁炉上的古董座钟停在七点十三分。\n\n留在庄园内的六位宾客——继承人、私人医生、前合伙人、女管家、歌剧名伶与秘书——每人都有不为人知的秘密与不在场证明裂缝。',
      en: 'An autumn tempest cuts off the last ferry to Blackreef Island, isolating a clockmaker magnate’s cliffside manor. Minutes before he was due to announce a revised will at dinner, guests force open his study—bolted from the inside—only to find him gone and the mantel clock stopped at 7:13.\n\nSix guests and retainers remain under the leaking slate roof, each hiding a motive and a fracture in their alibi.',
    },
    playerName: { zh: '温言', en: 'Arthur Vance' },
    playerConcept: {
      zh: '受庄园主生前匿名信重金相邀登岛的独立调查员，观察入微，擅长从证词漏洞中拼出真相',
      en: 'An observant private investigator summoned to the island by an anonymous letter from the host two days before the storm',
    },
    modules: ['clues', 'bonds', 'calendar', 'clocks', 'oracle', 'dice'],
  },
  {
    id: 'cyberpunk',
    category: 'worlds',
    glyph: '霓',
    title: {
      zh: '霓虹雨夜 · 密使芯片',
      en: 'Neon Rain: The Courier Chip',
    },
    tagline: {
      zh: '生态巨构阴影下的酸雨街区，一枚流出的加密记忆芯片引动帮派与财阀全面猎杀。',
      en: 'Every syndicate and corporate hit-squad in the lower wards is hunting the shard in your neural port.',
    },
    premise: {
      zh: '新九龙下城区的全息广告在酸雨夜幕中闪烁，高耸入云的泰坦生物生态巨构封锁了上层天际线。两小时前，一名重伤的旧识密使倒在你的安全屋门前，将一枚带有生物锁倒计时的原型记忆芯片塞进你手中，只留下一句“别信荒坂安全局的人”。\n\n此刻全城黑市悬赏频道已挂出你的义眼特征，三合会清道夫、义体黑医与公司反情报特工都在收紧包围网，而芯片里的加密扇区正在缓慢侵蚀读取者的神经回路。',
      en: 'Acid rain streaks neon holo-signs in the shadow of towering corporate arcologies. Two hours ago, a dying courier stumbled into your safehouse and slotted a prototype bio-locked memory shard into your palm with one warning: trust no one on the corporate payroll.\n\nNow bounty feeds across the lower wards flash your silhouette, syndicate sweepers and corporate fixers are closing the grid, and the shard’s countdown clock has forty-eight hours left.',
    },
    playerName: { zh: '林零', en: 'Vex' },
    playerConcept: {
      zh: '混迹下城区的独立密使与潜入专家，装有定制光学迷彩义体，在黑白两道夹缝中求生翻盘',
      en: 'An independent lower-ward courier and net-infiltrator with custom optical cyberware and debts on both sides of the law',
    },
    modules: ['clues', 'combat', 'dice', 'market', 'reputation', 'clocks', 'bonds'],
  },
  {
    id: 'fantasy',
    category: 'worlds',
    glyph: '林',
    title: {
      zh: '边陲古林 · 旧盟崩裂',
      en: 'Waking Boughs: The Frayed Treaty',
    },
    tagline: {
      zh: '沉睡千年的苍翠古林重现异象，凡人边镇与林冠深处生灵的古老盟约悄然崩裂。',
      en: 'At the edge of an ancient waking forest, old treaties between mortals and fey begin to fray.',
    },
    premise: {
      zh: '灰木镇坐落在王国的尽头与无垠古林的交界线上。三百年前，初代开拓者与林冠深处的古老王庭立下石碑血盟：凡人不伐圣树半步，古林生灵护佑河谷风调雨顺。然而今春以来，石碑符文逐一黯淡，入山采药的猎人带回银白枯叶，王都新派来的铁腕税务官却强令砍伐古林外围建造军械工坊。\n\n黄昏薄雾漫过木栅栏，林间传来百年未闻的鹿角号声，镇中长老、商队行会与林裔使者同时将目光投向刚刚入镇的你。',
      en: 'Greywood stands where the kingdom’s last road meets a forest older than crowns. Three centuries ago, mortals and the antlered courts beneath the boughs swore the Standing Stone Pact—yet this spring the runes have dimmed, hunters return with silver-blighted leaves, and a newly arrived royal magistrate demands timber from the sacred grove.\n\nAt dusk, horn-calls echo from the treeline for the first time in living memory.',
    },
    playerName: { zh: '艾琳', en: 'Rowan Ash' },
    playerConcept: {
      zh: '重返故土的守誓游侠，通晓古林旧语与追踪剑术，腰间佩着半枚先祖传下的盟约铜印',
      en: 'A returning oath-warden ranger who speaks the old sylvan tongue and carries half of an ancestral treaty seal',
    },
    modules: ['travel', 'combat', 'dice', 'market', 'bonds', 'reputation', 'calendar'],
  },
  {
    id: 'horror',
    category: 'worlds',
    glyph: '灯',
    title: {
      zh: '浓雾灯塔 · 潮汐归物',
      en: 'Fogbound Light: What the Tide Returns',
    },
    tagline: {
      zh: '反常浓雾笼罩海边小镇，潮水送回多年前沉没之物，镇民却全都视若无睹。',
      en: 'Unseasonal sea fog rolls over a lighthouse town as the tide returns things lost decades ago.',
    },
    premise: {
      zh: '白鸥岬是一座只有一条碎石公路通往内陆的偏僻渔港。自上月反常的灰白海雾锁死海面以来，每日退潮后的黑沙滩上都会多出几十年前海难失踪者的怀表、船铭牌乃至完好如初的旧信件，可镇上的渔民、牧师与旅店老板对此讳莫如深，只反复叮嘱你天黑后绝不可让北岬灯塔熄灭哪怕一息。\n\n今晚是你接任守塔人的第一夜，雾海中隐约浮现一艘本该在三十年前沉没的三桅帆船轮廓，而塔顶透镜室里传来湿漉漉的脚步声。',
      en: 'Gull’s Point is a salt-bleached harbour town shrouded in unseasonal sea fog. Each ebb tide leaves relics from wrecks lost thirty years ago pristine upon the shingle, while the townsfolk smile stiffly, say nothing, and warn you never to let the north headland lamp go dark.\n\nTonight is your first watch as the new lighthouse keeper—and through the fog, the silhouette of a long-sunk barque is drifting toward the rocks.',
    },
    playerName: { zh: '顾栖迟', en: 'Clara Hale' },
    playerConcept: {
      zh: '应聘前来的新任守塔人，随身带着失踪兄长留下的半本航海日志与一盏老黄铜提灯',
      en: 'The newly hired lighthouse keeper carrying half a ship’s logbook left behind by a vanished brother',
    },
    modules: ['clues', 'clocks', 'deck', 'oracle', 'bonds', 'calendar'],
  },
];

export const PRESET_PREMISES: Record<PresetId, Record<Locale, string>> = Object.fromEntries(
  SCENARIO_PRESETS.map((preset) => [preset.id, preset.premise]),
) as Record<PresetId, Record<Locale, string>>;

export function findScenarioPreset(id: PresetId | null): ScenarioPreset | undefined {
  if (!id) return undefined;
  return SCENARIO_PRESETS.find((p) => p.id === id);
}
