import { MODULE_IDS, type ModuleId, type ModuleLibraryEntry } from '@roleplay/shared';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { useGame } from '../../store/game';
import { useLibrary, useSubscriptions } from '../../store/library';
import { useUi } from '../../store/ui';
import { Icon } from '../Icon';
import { Modal } from '../Modal';
import { LibraryList, NO_FILTER, type LibraryFilter } from './LibraryList';
import { ModuleDetail } from './ModuleDetail';

/** Below this width the list and the detail take turns instead of sitting side by side. */
const SINGLE_PANE_QUERY = '(max-width: 760px)';

/**
 * The module library, in the spirit of an editor's extensions panel: every
 * module, searchable and filterable, and the selected one in full with the
 * action to subscribe or unsubscribe. Stacks on top of whatever dialog opened
 * it, so a half-filled new game is still there when it closes.
 */
export function ModuleLibrary() {
  const { t } = useTranslation();
  const requested = useUi((s) => s.library?.moduleId ?? null);
  const close = useUi((s) => s.closeLibrary);
  const entries = useLibrary((s) => s.entries);
  const status = useLibrary((s) => s.status);
  const load = useLibrary((s) => s.load);
  const subscriptions = useSubscriptions();
  const session = useGame((s) => s.current);
  const single = useMediaQuery(SINGLE_PANE_QUERY);
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  const [selected, setSelected] = useState<ModuleId>(requested ?? MODULE_IDS[0]);
  // In single-pane mode: which pane is showing. Opened on one module, it opens on its detail.
  const [showDetail, setShowDetail] = useState(requested !== null);
  const [filter, setFilter] = useState<LibraryFilter>(NO_FILTER);

  // The list is fetched each time the library opens: costs and tools come from the server.
  useEffect(() => {
    void load();
  }, [load]);

  const subscribed = subscriptions ?? [];
  const shown = useMemo(() => {
    if (!entries) return [];
    const query = filter.query.trim().toLowerCase();
    return entries
      .filter((entry) => {
        if (filter.onlySubscribed && !subscribed.includes(entry.id)) return false;
        if (filter.category && entry.category !== filter.category) return false;
        if (!query) return true;
        // Everything the library says about a module, so "time" finds the calendar and "health" the combat tracker.
        const haystack = [
          entry.id,
          t(`modules.names.${entry.id}`),
          t(`modules.taglines.${entry.id}`),
          t(`modules.descriptions.${entry.id}`),
          t(`modules.categories.${entry.category}`),
          t(`library.about.${entry.id}.purpose`),
          t(`library.about.${entry.id}.effect`),
          ...entry.tools,
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      })
      .map((entry) => entry.id);
  }, [entries, filter, subscribed, t]);

  // Side by side, the detail follows the search: a module filtered out of the list gives way to the first match.
  const current = single || shown.length === 0 || shown.includes(selected) ? selected : (shown[0] ?? selected);
  const entry: ModuleLibraryEntry | undefined = entries?.find((candidate) => candidate.id === current) ?? entries?.[0];
  const largestCost = Math.max(0, ...(entries ?? []).flatMap((candidate) => [candidate.promptTokens?.en ?? 0, candidate.promptTokens?.zh ?? 0]));

  const choose = (id: ModuleId) => {
    setSelected(id);
    if (single) setShowDetail(true);
  };

  // Moving to a module's detail moves focus to its name, so a screen reader starts reading there.
  useEffect(() => {
    if (single && showDetail) headingRef.current?.focus();
  }, [single, showDetail, selected]);

  const listPane = entries && (
    <LibraryList
      entries={entries}
      shown={shown}
      subscribed={subscribed}
      filter={filter}
      onFilter={setFilter}
      selected={single ? null : current}
      onSelect={choose}
      session={session}
    />
  );
  const detailPane = entry && (
    <div className="library__detail">
      {single && (
        <button type="button" className="btn btn--ghost btn--small library__back" onClick={() => setShowDetail(false)}>
          <Icon name="back" size={16} />
          {t('library.back')}
        </button>
      )}
      <ModuleDetail
        key={entry.id}
        entry={entry}
        subscribed={subscribed}
        largestCost={largestCost}
        session={session}
        headingRef={headingRef}
      />
    </div>
  );

  let body;
  if (entries) {
    if (single) body = <div className="library__body is-single">{showDetail ? detailPane : listPane}</div>;
    else
      body = (
        <div className="library__body">
          <div className="library__browse">{listPane}</div>
          {detailPane}
        </div>
      );
  } else if (status === 'error') {
    body = (
      <div className="dialog__body">
        <div className="form-error" role="alert">
          <p className="form-error__title">{t('library.loadFailed')}</p>
          <button type="button" className="btn btn--small" onClick={() => void load()}>
            <Icon name="retry" size={16} />
            {t('common.retry')}
          </button>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="dialog__body">
        <p className="muted" role="status">
          {t('library.loading')}
        </p>
      </div>
    );
  }

  return (
    <Modal labelledBy={titleId} onClose={close} className="modal--library">
      <div className="dialog library">
        <header className="dialog__head">
          <div className="library__heading">
            <h2 id={titleId} className="dialog__title">
              {t('library.title')}
            </h2>
            {subscriptions && (
              <p className="library__count">{t('library.count', { count: subscriptions.length, total: MODULE_IDS.length })}</p>
            )}
          </div>
          <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={close}>
            <Icon name="close" />
          </button>
        </header>
        {body}
      </div>
    </Modal>
  );
}
