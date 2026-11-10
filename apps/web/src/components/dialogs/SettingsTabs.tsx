import { useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

export interface TabSpec<T extends string> {
  id: T;
  label: string;
  /** Show a dot: something on this tab needs the player's attention. */
  attention?: boolean;
}

interface SettingsTabsProps<T extends string> {
  idBase: string;
  label: string;
  tabs: ReadonlyArray<TabSpec<T>>;
  selected: T;
  onSelect: (tab: T) => void;
}

export const tabId = (idBase: string, tab: string) => `${idBase}-tab-${tab}`;
export const panelId = (idBase: string, tab: string) => `${idBase}-panel-${tab}`;

/** A WAI-ARIA tab list with arrow-key navigation; the caller renders the panel. */
export function SettingsTabs<T extends string>({ idBase, label, tabs, selected, onSelect }: SettingsTabsProps<T>) {
  const { t } = useTranslation();
  const refs = useRef(new Map<string, HTMLButtonElement>());

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = tabs.findIndex((tab) => tab.id === selected);
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    const tab = tabs[next];
    if (!tab) return;
    onSelect(tab.id);
    refs.current.get(tab.id)?.focus();
  };

  return (
    <div className="dialog-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => {
        const isSelected = tab.id === selected;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              if (el) refs.current.set(tab.id, el);
              else refs.current.delete(tab.id);
            }}
            type="button"
            role="tab"
            id={tabId(idBase, tab.id)}
            aria-controls={panelId(idBase, tab.id)}
            aria-selected={isSelected}
            tabIndex={isSelected ? 0 : -1}
            className="dialog-tabs__tab"
            onClick={() => onSelect(tab.id)}
            onKeyDown={onKeyDown}
          >
            {tab.label}
            {tab.attention && (
              <>
                <span className="dialog-tabs__dot" aria-hidden="true" />
                <span className="sr-only"> {t('settings.needsAttention')}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
