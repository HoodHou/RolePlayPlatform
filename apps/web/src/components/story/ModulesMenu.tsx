import { MODULE_IDS, type ModuleId, type Session } from '@roleplay/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toUiError, type UiError } from '../../api/errors';
import { useLocale } from '../../i18n';
import { describeError } from '../../lib/describe';
import {
  hasModuleState,
  moduleDisplayDescription,
  moduleDisplayName,
  moduleKeptWhileOffNote,
  modulesOf,
  playedModules,
  withModule,
} from '../../lib/modules';
import { useGame } from '../../store/game';
import { useLibrary, useSubscriptions } from '../../store/library';
import { useUi } from '../../store/ui';
import { Icon } from '../Icon';
import { ModuleGlyph } from '../ModuleGlyph';

/**
 * Which play modules the story is played with, as a quiet line under the
 * composer, and switches for them in a panel that opens upward: the story's
 * modules and every other one the player subscribes to. A module the story has
 * but the player no longer subscribes to is shown apart, out of play, with the
 * way back through the library. Locked while a turn is being generated: the
 * server refuses changes then, and they would only apply to the next turn anyway.
 */
export function ModulesMenu({ session }: { session: Session }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const running = useGame((s) => s.turn !== null);
  const setModules = useGame((s) => s.setModules);
  const openLibrary = useUi((s) => s.openLibrary);
  const entries = useLibrary((s) => s.entries);
  const subscribed = useSubscriptions();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const modules = modulesOf(session);
  const played = playedModules(session, subscribed);
  // Not knowing the subscriptions yet, offer every module: the server only switches on subscribed ones.
  const switchable: readonly ModuleId[] = subscribed ?? MODULE_IDS;
  const outOfPlay = subscribed ? modules.filter((module) => !subscribed.includes(module)) : [];

  let summary: string;
  if (session.modulesAuto) summary = t('modules.summaryAuto');
  else if (played.length === 0) summary = t('modules.summaryNone');
  else
    summary = t('modules.summary', {
      list: played.map((module) => moduleDisplayName(module, entries, locale, t)).join(' · '),
    });
  if (outOfPlay.length > 0) summary = t('modules.summaryOutOfPlay', { summary, count: outOfPlay.length });

  // A click anywhere else or Esc closes the panel.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Another story is another set of modules.
  useEffect(() => {
    setOpen(false);
    setError(null);
  }, [session.id]);

  const toggle = async (module: ModuleId, on: boolean) => {
    setSaving(true);
    setError(null);
    try {
      await setModules(withModule(modules, module, on));
    } catch (err) {
      setError(toUiError(err));
    } finally {
      setSaving(false);
    }
  };

  /** Closes the panel and opens the library; focus comes back to the menu's button when the library closes. */
  const toLibrary = (module?: ModuleId) => {
    buttonRef.current?.focus();
    setOpen(false);
    openLibrary(module);
  };

  return (
    <div className="modules" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="modules__button"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="modules" size={14} />
        <span className="modules__summary">{summary}</span>
        <Icon name="chevron" size={13} className="modules__chevron" />
      </button>

      {open && (
        <div id={`${id}-panel`} className="modules__panel" role="group" aria-labelledby={`${id}-title`}>
          <div className="modules__head">
            <p id={`${id}-title`} className="modules__title">
              {t('modules.label')}
            </p>
            <button type="button" className="btn btn--ghost btn--small modules__library" onClick={() => toLibrary()}>
              <Icon name="modules" size={14} />
              {t('modules.library')}
            </button>
          </div>
          {session.modulesAuto && <p className="modules__note">{t('modules.autoNote')}</p>}

          {switchable.length > 0 ? (
            <ul className="modules__list">
              {switchable.map((module) => {
                const on = modules.includes(module);
                // A module switched off keeps what it recorded; say so, so turning it off doesn't feel like losing it.
                const kept = !on && hasModuleState(session.world, module);
                const libEntry = entries?.find((e) => e.id === module);
                return (
                  <li key={module} className="modules__item">
                    <label className="switch">
                      <input
                        type="checkbox"
                        role="switch"
                        className="switch__input"
                        checked={on}
                        disabled={running || saving}
                        aria-describedby={`${id}-${module}`}
                        onChange={(event) => void toggle(module, event.target.checked)}
                      />
                      <span className="switch__track" aria-hidden="true" />
                      <ModuleGlyph id={module} category={libEntry?.category} glyph={libEntry?.plugin?.glyph} size="small" />
                      <span className="modules__name">{moduleDisplayName(module, entries, locale, t)}</span>
                    </label>
                    <div id={`${id}-${module}`} className="modules__desc">
                      <p>{moduleDisplayDescription(module, entries, locale, t)}</p>
                      {kept && <p className="modules__kept">{moduleKeptWhileOffNote(module, t)}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="modules__empty">
              <p>{t('modules.noneSubscribed')}</p>
              <button type="button" className="btn btn--small" onClick={() => toLibrary()}>
                {t('modules.openLibrary')}
              </button>
            </div>
          )}

          {outOfPlay.length > 0 && (
            <section className="modules__away" aria-labelledby={`${id}-away`}>
              <p id={`${id}-away`} className="modules__title">
                {t('modules.outOfPlay')}
              </p>
              <ul className="modules__list">
                {outOfPlay.map((module) => {
                  const libEntry = entries?.find((e) => e.id === module);
                  return (
                    <li key={module} className="modules__item modules__item--away">
                      <p className="modules__away-name">
                        <ModuleGlyph id={module} category={libEntry?.category} glyph={libEntry?.plugin?.glyph} size="small" />
                        <span className="modules__name">{moduleDisplayName(module, entries, locale, t)}</span>
                      </p>
                      <div className="modules__desc">
                        <p>{t('modules.outOfPlayNote')}</p>
                        <button type="button" className="link-btn" onClick={() => toLibrary(module)}>
                          {t('modules.openInLibrary')}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {error && (
            <div className="form-error modules__error" role="alert">
              <p className="form-error__title">{t('modules.failed')}</p>
              <p>{describeError(t, error)}</p>
            </div>
          )}
          <p className="modules__foot">{running ? t('modules.busy') : t('modules.nextTurn')}</p>
        </div>
      )}
    </div>
  );
}
