import type { WorldState } from '@roleplay/shared';
import { useId, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { inventoryOf, npcsOf, splitLore } from '../../lib/world';
import { useUi, WORLD_TABS, type WorldTab } from '../../store/ui';
import { CharactersTab } from './CharactersTab';
import { InventoryTab } from './InventoryTab';
import { LoreTab } from './LoreTab';
import { PlacesTab } from './PlacesTab';
import { QuestsTab } from './QuestsTab';

function countFor(tab: WorldTab, world: WorldState): number {
  switch (tab) {
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

export function WorldTabs({ world, lang }: { world: WorldState; lang: string }) {
  const { t } = useTranslation();
  const selected = useUi((s) => s.worldTab);
  const select = useUi((s) => s.setWorldTab);
  const baseId = useId();
  const tabRefs = useRef<Partial<Record<WorldTab, HTMLButtonElement | null>>>({});

  // Arrow keys move between tabs (automatic activation), as in the WAI-ARIA tabs pattern.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = WORLD_TABS.indexOf(selected);
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % WORLD_TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + WORLD_TABS.length) % WORLD_TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = WORLD_TABS.length - 1;
    else return;
    event.preventDefault();
    const tab = WORLD_TABS[next];
    if (!tab) return;
    select(tab);
    tabRefs.current[tab]?.focus();
  };

  return (
    <div className="tabs">
      <div className="tabs__list" role="tablist" aria-label={t('world.tabsLabel')}>
        {WORLD_TABS.map((tab) => {
          const count = countFor(tab, world);
          const isSelected = tab === selected;
          return (
            <button
              key={tab}
              ref={(el) => {
                tabRefs.current[tab] = el;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab}`}
              aria-controls={`${baseId}-panel-${tab}`}
              aria-selected={isSelected}
              tabIndex={isSelected ? 0 : -1}
              className="tabs__tab"
              onClick={() => select(tab)}
              onKeyDown={onKeyDown}
            >
              {t(`world.tabs.${tab}`)}
              {count > 0 && (
                <>
                  <span className="sr-only"> </span>
                  <span className="tabs__count">{count}</span>
                </>
              )}
            </button>
          );
        })}
      </div>
      <div
        className="tabs__panel"
        role="tabpanel"
        id={`${baseId}-panel-${selected}`}
        aria-labelledby={`${baseId}-tab-${selected}`}
        tabIndex={0}
      >
        {selected === 'characters' && <CharactersTab world={world} lang={lang} />}
        {selected === 'inventory' && <InventoryTab world={world} lang={lang} />}
        {selected === 'quests' && <QuestsTab world={world} lang={lang} />}
        {selected === 'places' && <PlacesTab world={world} lang={lang} />}
        {selected === 'lore' && <LoreTab world={world} lang={lang} />}
      </div>
    </div>
  );
}
