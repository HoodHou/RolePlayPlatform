import type {
  Character,
  ClanRelative,
  ConsortEntry,
  CourtFaction,
  CourtMemorial,
  CourtOfficial,
  DomainFacility,
  HeirEntry,
  Session,
  SpyAgent,
  WorldState,
} from '@roleplay/shared';

export interface CharacterCrossRoles {
  official?: CourtOfficial;
  faction?: CourtFaction;
  consort?: ConsortEntry;
  heir?: HeirEntry;
  relative?: ClanRelative;
  stewardFacilities: DomainFacility[];
  isSpyCommander: boolean;
  spyAgent?: SpyAgent;
}

/** Collects every module-registered office, household standing, or post held by a character. */
export function rolesOfCharacter(world: WorldState, characterId: string): CharacterCrossRoles {
  const court = world.modules?.court;
  const official = court?.officials[characterId];
  const faction = official?.factionId ? court?.factions[official.factionId] : undefined;

  const lineage = world.modules?.lineage;
  const consort = lineage?.consorts[characterId];
  const heir = lineage?.heirs[characterId];
  const relative = lineage?.relatives[characterId];

  const domain = world.modules?.domain;
  const stewardFacilities = domain
    ? Object.values(domain.facilities).filter((f) => f.stewardId === characterId)
    : [];

  const espionage = world.modules?.espionage;
  const isSpyCommander = espionage?.commanderId === characterId;
  const spyAgent = espionage
    ? Object.values(espionage.agents).find((a) => a.characterId === characterId)
    : undefined;

  return {
    official,
    faction,
    consort,
    heir,
    relative,
    stewardFacilities,
    isSpyCommander,
    spyAgent,
  };
}

/** Concise primary standing ribbon for portrait cards and conversation stage headers. */
export function primaryStandingOf(world: WorldState, character: Character): string {
  const roles = rolesOfCharacter(world, character.id);
  if (roles.official) {
    return roles.official.rank ? `${roles.official.office} · ${roles.official.rank}` : roles.official.office;
  }
  if (roles.heir) {
    return roles.heir.title || roles.heir.order || character.role;
  }
  if (roles.consort) {
    return roles.consort.palace ? `${roles.consort.title} · ${roles.consort.palace}` : roles.consort.title;
  }
  if (roles.relative) {
    return roles.relative.title || roles.relative.relation || character.role;
  }
  if (roles.stewardFacilities.length > 0 && roles.stewardFacilities[0]) {
    return character.role || roles.stewardFacilities[0].name;
  }
  return character.role;
}

/** Whether the open world is playing an imperial / dynastic court or household setup. */
export function isImperialWorld(world: WorldState): boolean {
  return Boolean(world.modules?.court || world.modules?.lineage);
}

/** Pre-fills a story-language composer prompt to summon or seek out an off-scene character. */
export function draftSummonOrSeek(session: Session, character: Character): string {
  const { world, language } = session;
  const roles = rolesOfCharacter(world, character.id);
  const titlePrefix =
    roles.official?.office ||
    roles.consort?.title ||
    roles.heir?.title ||
    roles.relative?.title ||
    '';

  if (isImperialWorld(world)) {
    if (language === 'zh') {
      return `宣召${titlePrefix ? `${titlePrefix} ` : ''}${character.name}觐见：`;
    }
    return `Summon ${titlePrefix ? `${titlePrefix} ` : ''}${character.name} for an audience: `;
  }

  if (language === 'zh') {
    return `前往寻访${character.name}：`;
  }
  return `Seek out ${character.name}: `;
}

/** Pre-fills a story-language composer prompt to issue an imperial rescript ("朱批") on a memorial. */
export function draftRuleOnMemorial(session: Session, memorial: CourtMemorial): string {
  if (session.language === 'zh') {
    return `批阅奏折《${memorial.title}》：`;
  }
  return `Rule on memorial "${memorial.title}": `;
}
