import { MODULE_CATEGORIES, type ModuleCategory, type ModuleId, type ModuleLibraryEntry, type Session } from '@roleplay/shared';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { relationOf } from '../../lib/modules';
import { Icon } from '../Icon';
import { ModuleGlyph } from '../ModuleGlyph';

export interface LibraryFilter {
  query: string;
  onlySubscribed: boolean;
  category: ModuleCategory | null;
}

export const NO_FILTER: LibraryFilter = { query: '', onlySubscribed: false, category: null };

interface LibraryListProps {
  entries: ModuleLibraryEntry[];
  /** Ids that pass the filter, in list order. */
  shown: ModuleId[];
  subscribed: readonly ModuleId[];
  filter: LibraryFilter;
  onFilter: (filter: LibraryFilter) => void;
  /** Highlighted as the one in the detail pane; null when the list stands alone. */
  selected: ModuleId | null;
  onSelect: (id: ModuleId) => void;
  session: Session | null;
}

/** Search, filters and the list of modules, each with its mark, name, line, kind and whether it is subscribed. */
export function LibraryList({ entries, shown, subscribed, filter, onFilter, selected, onSelect, session }: LibraryListProps) {
  const { t } = useTranslation();
  const id = useId();
  const filtered = filter.query.trim() !== '' || filter.onlySubscribed || filter.category !== null;

  return (
    <div className="library-list">
      <div className="library-list__tools">
        <p className="library-list__intro">{t('library.intro')}</p>
        <label className="library-search">
          <span className="sr-only">{t('library.searchLabel')}</span>
          <Icon name="search" size={16} className="library-search__icon" />
          <input
            type="search"
            className="input library-search__input"
            value={filter.query}
            placeholder={t('library.searchPlaceholder')}
            autoComplete="off"
            data-autofocus
            onChange={(event) => onFilter({ ...filter, query: event.target.value })}
          />
        </label>
        <div className="library-list__filters">
          <div className="segmented segmented--compact" role="group" aria-label={t('library.filterLabel')}>
            {([false, true] as const).map((only) => (
              <button
                key={String(only)}
                type="button"
                className="segmented__button"
                aria-pressed={filter.onlySubscribed === only}
                onClick={() => onFilter({ ...filter, onlySubscribed: only })}
              >
                {only ? t('library.show.subscribed') : t('library.show.all')}
                {only && <span className="library-list__count"> {subscribed.length}</span>}
              </button>
            ))}
          </div>
          <div className="library-list__categories" role="group" aria-label={t('library.categoryLabel')}>
            <button
              type="button"
              className="chip-button"
              aria-pressed={filter.category === null}
              onClick={() => onFilter({ ...filter, category: null })}
            >
              {t('library.anyCategory')}
            </button>
            {MODULE_CATEGORIES.map((category) => (
              <button
                key={category}
                type="button"
                className="chip-button"
                aria-pressed={filter.category === category}
                onClick={() => onFilter({ ...filter, category: filter.category === category ? null : category })}
              >
                {t(`modules.categories.${category}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {shown.length > 0 ? (
        <ul className="library-list__items" aria-label={t('library.listLabel')} aria-describedby={`${id}-status`}>
          {entries
            .filter((entry) => shown.includes(entry.id))
            .map((entry) => {
              const isSubscribed = subscribed.includes(entry.id);
              const relation = session ? relationOf(session, entry.id, subscribed) : null;
              const isSelected = entry.id === selected;
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    className={isSelected ? 'library-item is-selected' : 'library-item'}
                    aria-current={isSelected ? 'true' : undefined}
                    onClick={() => onSelect(entry.id)}
                  >
                    <ModuleGlyph id={entry.id} />
                    <span className="library-item__body">
                      <span className="library-item__top">
                        <span className="library-item__name">{t(`modules.names.${entry.id}`)}</span>
                        {isSubscribed && (
                          <span className="library-item__state">
                            <Icon name="check" size={13} />
                            {t('library.subscribed')}
                          </span>
                        )}
                      </span>
                      <span className="library-item__tagline">{t(`modules.taglines.${entry.id}`)}</span>
                      <span className="library-item__meta">
                        {t(`modules.categories.${entry.category}`)}
                        {relation === 'on' && <span className="library-item__here"> · {t('library.onHere')}</span>}
                        {relation === 'outOfPlay' && <span className="library-item__away"> · {t('library.outOfPlayHere')}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
        </ul>
      ) : (
        <div className="library-list__empty">
          <p>{t('library.noMatch')}</p>
          {filtered && (
            <button type="button" className="btn btn--small" onClick={() => onFilter(NO_FILTER)}>
              {t('library.clearFilters')}
            </button>
          )}
        </div>
      )}
      <p id={`${id}-status`} className="sr-only" aria-live="polite">
        {t('library.shown', { count: shown.length, total: entries.length })}
      </p>
    </div>
  );
}
