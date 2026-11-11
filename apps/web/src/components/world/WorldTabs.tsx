import type { ModuleId, Session, WorldState } from '@roleplay/shared';
import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../../i18n';
import { bondsOf } from '../../lib/bonds';
import { calendarOf, scheduleOf } from '../../lib/calendar';
import { visibleClocks } from '../../lib/clocks';
import { fightOf } from '../../lib/combat';
import { MODULE_GLYPH, moduleDisplayName, relationOf } from '../../lib/modules';
import { boardOf } from '../../lib/sandbox';
import { inventoryOf, npcsOf, splitLore } from '../../lib/world';
import { useLibrary } from '../../store/library';
import { MODULE_VIEWS, useUi, WORLD_TABS, type ModuleView, type WorldTab } from '../../store/ui';
import { BondsTab } from './BondsTab';
import { CalendarTab } from './CalendarTab';
import { CharactersTab } from './CharactersTab';
import { ClocksTab } from './ClocksTab';
import { CluesTab, visibleClues } from './CluesTab';
import { CombatTab } from './CombatTab';
import { CourtTab, hasCourtContent, pendingMemorialCount } from './CourtTab';
import { CustomModuleTab } from './CustomModuleTab';
import { DeckTab } from './DeckTab';
import { DomainTab, hasDomainContent } from './DomainTab';
import { EspionageTab, hasEspionageContent } from './EspionageTab';
import { InventoryTab } from './InventoryTab';
import { LineageTab, hasLineageContent, lineageMemberCount } from './LineageTab';
import { LoreTab } from './LoreTab';
import { MarketTab } from './MarketTab';
import { ModuleNote } from './ModuleNote';
import { PlacesTab } from './PlacesTab';
import { ProgressionTab, hasProgressionContent } from './ProgressionTab';
import { QuestsTab } from './QuestsTab';
import { ReputationTab } from './ReputationTab';
import { SandboxTab } from './SandboxTab';
import { TravelTab, visibleRoutes } from './TravelTab';

/** Whether a module view has anything to show. A hidden clock alone does not count unless secrets are shown. */
function hasView(view: ModuleView, world: WorldState, showSecrets: boolean): boolean {
  switch (view) {
    case 'combat':
      return fightOf(world) !== undefined;
    case 'court':
      return hasCourtContent(world);
    case 'lineage':
      return hasLineageContent(world);
    case 'domain':
      return hasDomainContent(world);
    case 'espionage':
      return hasEspionageContent(world, showSecrets);
    case 'progression':
      return hasProgressionContent(world);
    case 'clocks':
      return visibleClocks(world, showSecrets).length > 0;
    case 'calendar':
      return calendarOf(world) !== undefined;
    case 'bonds':
      return bondsOf(world).length > 0;
    case 'sandbox':
      return boardOf(world) !== undefined;
    case 'market':
      return Object.keys(world.modules?.market?.shops ?? {}).length > 0;
    case 'clues': {
      const { clues, deductions } = visibleClues(world, showSecrets);
      return clues.length > 0 || deductions.length > 0;
    }
    case 'travel':
      return visibleRoutes(world, showSecrets).length > 0;
    case 'deck': {
      const deck = world.modules?.deck;
      return deck !== undefined && (Object.keys(deck.decks).length > 0 || Object.keys(deck.tables).length > 0);
    }
    case 'reputation':
      return Object.keys(world.modules?.reputation?.standings ?? {}).length > 0;
  }
}

function isCustomTab(tab: WorldTab): tab is `custom:${string}` {
  return tab.startsWith('custom:');
}

/** The small number beside a tab's name; for the calendar, what has come due and awaits the story. */
function countFor(tab: WorldTab, world: WorldState, showSecrets: boolean): number {
  if (isCustomTab(tab)) {
    const customId = tab.slice(7);
    return Object.keys(world.modules?.custom?.[customId]?.entries ?? {}).length;
  }
  switch (tab) {
    case 'combat':
    case 'sandbox':
    case 'progression':
      return 0;
    case 'court': {
      const pending = pendingMemorialCount(world);
      return pending > 0 ? pending : Object.keys(world.modules?.court?.officials ?? {}).length;
    }
    case 'lineage':
      return lineageMemberCount(world);
    case 'domain':
      return Object.keys(world.modules?.domain?.facilities ?? {}).length;
    case 'espionage':
      return Object.keys(world.modules?.espionage?.agents ?? {}).length;
    case 'clocks':
      return visibleClocks(world, showSecrets).length;
    case 'calendar': {
      const calendar = calendarOf(world);
      return calendar ? scheduleOf(calendar, showSecrets).due.length : 0;
    }
    case 'bonds':
      return bondsOf(world).length;
    case 'market':
      return Object.keys(world.modules?.market?.shops ?? {}).length;
    case 'clues':
      return visibleClues(world, showSecrets).clues.length;
    case 'travel':
      return visibleRoutes(world, showSecrets).length;
    case 'deck': {
      const deck = world.modules?.deck;
      return deck ? Object.keys(deck.decks).length + Object.keys(deck.tables).length : 0;
    }
    case 'reputation':
      return Object.keys(world.modules?.reputation?.standings ?? {}).length;
    case 'characters':
      return npcsOf(world).length;
    case 'inventory':
      return inventoryOf(world).length;
    case 'quests':
      return Object.values(world.quests).filter((q) => q.status === 'active').length;
    case 'places':
      return Object.keys(world.locations).length;
    case 'lore':
      return splitLore(world).visible.length;
  }
}

interface WorldTabsProps {
  session: Session;
  subscriptions: readonly ModuleId[] | null;
  lang: string;
}

/**
 * The world's details. The world's own tabs are always there; above them, in a
 * row of their own, a view for each play module that has something to show
 * (a fight, clocks, the calendar, bonds, the board). A module's view stays
 * while its state does, even with the module off or out of play, with a note
 * saying so: what it shows is still the world.
 */
export function WorldTabs({ session, subscriptions, lang }: WorldTabsProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const entries = useLibrary((s) => s.entries);
  const picked = useUi((s) => s.worldTab);
  const select = useUi((s) => s.setWorldTab);
  const showSecrets = useUi((s) => s.showSecrets);
  const baseId = useId();
  const tabRefs = useRef<Partial<Record<WorldTab, HTMLButtonElement | null>>>({});

  const { world } = session;
  const views = MODULE_VIEWS.filter((view) => hasView(view, world, showSecrets));
  const customIds = Object.keys(world.modules?.custom ?? {}).filter(
    (id) => Object.keys(world.modules?.custom?.[id]?.entries ?? {}).length > 0,
  );
  const customTabs: WorldTab[] = customIds.map((id): WorldTab => `custom:${id}`);
  const tabs: WorldTab[] = [...views, ...customTabs, ...WORLD_TABS];
  const fight = fightOf(world);
  const fighting = fight?.active === true;
  const board = boardOf(world);
  const calendar = calendarOf(world);

  // Until the player picks a tab, a story opens on a fight that is on, then on its court or board.
  let fallback: WorldTab = 'characters';
  if (fighting) fallback = 'combat';
  else if (hasCourtContent(world)) fallback = 'court';
  else if (board) fallback = 'sandbox';
  const selected = picked !== null && tabs.includes(picked) ? picked : fallback;

  // A fight breaking out is what the panel should show, whatever tab was open.
  const wasFighting = useRef(fighting);
  useEffect(() => {
    if (fighting && !wasFighting.current) select('combat');
    wasFighting.current = fighting;
  }, [fighting, select]);

  // Arrow keys move between tabs (automatic activation), as in the WAI-ARIA tabs pattern.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = tabs.indexOf(selected);
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    const tab = tabs[next];
    if (!tab) return;
    select(tab);
    tabRefs.current[tab]?.focus();
  };

  const tabProps = (tab: WorldTab) => ({
    ref: (el: HTMLButtonElement | null) => {
      tabRefs.current[tab] = el;
    },
    type: 'button' as const,
    role: 'tab',
    id: `${baseId}-tab-${tab}`,
    'aria-controls': `${baseId}-panel-${tab}`,
    'aria-selected': tab === selected,
    tabIndex: tab === selected ? 0 : -1,
    onClick: () => select(tab),
    onKeyDown,
  });

  const count = (tab: WorldTab) => {
    const n = countFor(tab, world, showSecrets);
    if (n <= 0) return null;
    const due = tab === 'calendar' || (tab === 'court' && pendingMemorialCount(world) > 0);
    return (
      <>
        <span className="sr-only"> </span>
        <span className={due ? 'tabs__count tabs__count--due' : 'tabs__count'}>{n}</span>
      </>
    );
  };

  const selectedView = (MODULE_VIEWS as readonly WorldTab[]).includes(selected) ? (selected as ModuleView) : null;
  const selectedCustomId = selected.startsWith('custom:') ? selected.slice(7) : null;
  const selectedCustomState = selectedCustomId ? world.modules?.custom?.[selectedCustomId] : undefined;

  return (
    <div className="tabs">
      <div className="tabs__list" role="tablist" aria-label={t('world.tabsLabel')}>
        {(views.length > 0 || customIds.length > 0) && (
          <div className="tabs__modules" role="none">
            {views.map((view) => {
              const off = relationOf(session, view, subscriptions) !== 'on';
              const live = view === 'combat' && fighting;
              return (
                <button key={view} {...tabProps(view)} className={`tabs__module${off ? ' is-off' : ''}${live ? ' is-live' : ''}`}>
                  <span className="tabs__glyph" aria-hidden="true">
                    {MODULE_GLYPH[view]}
                  </span>
                  {t(`world.tabs.${view}`)}
                  {live && <span className="live-dot" aria-hidden="true" />}
                  {count(view)}
                  {live && <span className="sr-only">, {t('world.tabState.live')}</span>}
                  {off && <span className="sr-only">, {t('world.tabState.off')}</span>}
                </button>
              );
            })}
            {customIds.map((customId) => {
              const tabKey: WorldTab = `custom:${customId}`;
              const modId = customId as ModuleId;
              const off = relationOf(session, modId, subscriptions) !== 'on';
              const libEntry = entries?.find((e) => e.id === modId);
              const glyph = libEntry?.plugin?.glyph ?? '✦';
              const label =
                libEntry?.plugin
                  ? moduleDisplayName(modId, entries, locale, t)
                  : (world.modules?.custom?.[customId]?.name || customId);
              return (
                <button key={tabKey} {...tabProps(tabKey)} className={`tabs__module${off ? ' is-off' : ''}`}>
                  <span className="tabs__glyph" aria-hidden="true">
                    {glyph}
                  </span>
                  {label}
                  {count(tabKey)}
                  {off && <span className="sr-only">, {t('world.tabState.off')}</span>}
                </button>
              );
            })}
          </div>
        )}
        <div className="tabs__row" role="none">
          {WORLD_TABS.map((tab) => (
            <button key={tab} {...tabProps(tab)} className="tabs__tab">
              {t(`world.tabs.${tab}`)}
              {count(tab)}
            </button>
          ))}
        </div>
      </div>
      <div
        className="tabs__panel"
        role="tabpanel"
        id={`${baseId}-panel-${selected}`}
        aria-labelledby={`${baseId}-tab-${selected}`}
        tabIndex={0}
      >
        {selectedView && <ModuleNote id={selectedView} relation={relationOf(session, selectedView, subscriptions)} />}
        {selectedCustomId && (
          <ModuleNote
            id={selectedCustomId as ModuleId}
            relation={relationOf(session, selectedCustomId as ModuleId, subscriptions)}
          />
        )}
        {selectedCustomState && <CustomModuleTab state={selectedCustomState} lang={lang} />}
        {selected === 'combat' && fight && <CombatTab fight={fight} world={world} lang={lang} />}
        {selected === 'court' && <CourtTab session={session} lang={lang} />}
        {selected === 'lineage' && <LineageTab session={session} lang={lang} />}
        {selected === 'domain' && <DomainTab world={world} lang={lang} />}
        {selected === 'espionage' && <EspionageTab world={world} lang={lang} />}
        {selected === 'progression' && <ProgressionTab world={world} lang={lang} />}
        {selected === 'clocks' && <ClocksTab world={world} lang={lang} />}
        {selected === 'calendar' && calendar && <CalendarTab calendar={calendar} lang={lang} />}
        {selected === 'bonds' && <BondsTab world={world} lang={lang} />}
        {selected === 'sandbox' && board && <SandboxTab board={board} world={world} lang={lang} />}
        {selected === 'market' && world.modules?.market && (
          <MarketTab market={world.modules.market} world={world} lang={lang} />
        )}
        {selected === 'clues' && <CluesTab world={world} lang={lang} />}
        {selected === 'travel' && <TravelTab world={world} lang={lang} />}
        {selected === 'deck' && world.modules?.deck && <DeckTab deck={world.modules.deck} lang={lang} />}
        {selected === 'reputation' && <ReputationTab world={world} lang={lang} />}
        {selected === 'characters' && <CharactersTab world={world} lang={lang} />}
        {selected === 'inventory' && <InventoryTab world={world} lang={lang} />}
        {selected === 'quests' && <QuestsTab world={world} lang={lang} />}
        {selected === 'places' && <PlacesTab world={world} lang={lang} />}
        {selected === 'lore' && <LoreTab world={world} lang={lang} />}
      </div>
    </div>
  );
}
