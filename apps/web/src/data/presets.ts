import type { Locale } from '@roleplay/shared';

export const PRESET_IDS = ['fantasy', 'cyberpunk', 'xianxia', 'mystery', 'horror'] as const;

export type PresetId = (typeof PRESET_IDS)[number];

export const PRESET_PREMISES: Record<PresetId, Record<Locale, string>> = {
  fantasy: {
    en: 'A frontier town at the edge of an ancient, waking forest, where old treaties between mortals and what lives beneath the boughs have begun to fray.',
    zh: '古老森林边缘的边陲小镇，凡人与林冠深处生灵立下的旧盟约正在悄然崩裂。',
  },
  cyberpunk: {
    en: 'Rain-slicked neon streets in the shadow of towering arcologies, where a leaked courier chip has every syndicate and corporate fixer in the lower wards hunting the same trail.',
    zh: '高耸生态巨构阴影下的霓虹雨夜，一枚流出的密使芯片引得下城区各路帮派与公司中间人闻风而动。',
  },
  xianxia: {
    en: 'Cloud-ringed peaks of a once-great immortal sect on the eve of its centennial trial, as long-sealed spirit veins stir beneath the mountain gate.',
    zh: '昔日名门仙宗山门日渐凋零，百年试炼将至之际，山底尘封已久的灵脉忽然异动。',
  },
  mystery: {
    en: 'A cliffside manor cut off by an autumn storm after the last ferry stops running, where the host has vanished from a study locked from the inside.',
    zh: '秋夜暴风雨断绝了最后一班渡轮，悬崖庄园与世隔绝，主人却从反锁的书房中离奇失踪。',
  },
  horror: {
    en: 'A coastal lighthouse town shrouded in unseasonal fog, where the tide brings back things lost years ago and the townsfolk pretend not to notice.',
    zh: '反常浓雾笼罩的海边灯塔小镇，潮水将多年前失落之物一一送回岸上，镇民却全都对此视若无睹。',
  },
};
