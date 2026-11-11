import { LOCALES, type ModuleId, type ModuleLibraryEntry, type Session } from '@roleplay/shared';
import { useEffect, useId, useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { toUiError, type UiError } from '../../api/errors';
import { languageTag, useLocale } from '../../i18n';
import { describeError } from '../../lib/describe';
import { hasModuleState, modulesOf, relationOf, withModule } from '../../lib/modules';
import { formatNumber } from '../../lib/text';
import { useGame } from '../../store/game';
import { useLibrary } from '../../store/library';
import { MODULE_VIEWS, type ModuleView } from '../../store/ui';
import { Icon } from '../Icon';
import { ModuleGlyph } from '../ModuleGlyph';

/** The tools the library has a line for; a tool a newer server adds is listed by name alone. */
const KNOWN_TOOLS = [
  'check',
  'roll_dice',
  'fight',
  'ask_fate',
  'pass_time',
  'simulate',
  'trade',
  'journey',
  'draw',
  'hold_court',
  'nurture_heir',
  'develop_domain',
  'run_operation',
  'breakthrough',
] as const;
type KnownTool = (typeof KNOWN_TOOLS)[number];
const isKnownTool = (name: string): name is KnownTool => (KNOWN_TOOLS as readonly string[]).includes(name);

/** Estimates are rough; a round number says so. */
function roughly(tokens: number): number {
  return tokens >= 100 ? Math.round(tokens / 10) * 10 : tokens;
}

/** The open story and this module: on, off, or kept but out of play; and the switch for it when subscribed. */
function StoryUse({ session, entry, subscribed }: { session: Session; entry: ModuleLibraryEntry; subscribed: readonly ModuleId[] }) {
  const { t } = useTranslation();
  const running = useGame((s) => s.turn !== null);
  const setModules = useGame((s) => s.setModules);
  const id = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<UiError | null>(null);

  const relation = relationOf(session, entry.id, subscribed);
  const title = session.world.title || t('library.story.untitled');
  let text: string;
  if (relation === 'on') text = session.modulesAuto ? t('library.story.onAuto', { title }) : t('library.story.on', { title });
  else if (relation === 'off') text = t('library.story.off', { title });
  else if (relation === 'outOfPlay') text = t('library.story.outOfPlay', { title });
  else text = t('library.story.unavailable', { title });
  const switchable = relation === 'on' || relation === 'off';
  const kept = relation === 'off' && hasModuleState(session.world, entry.id);

  const toggle = async (on: boolean) => {
    setSaving(true);
    setError(null);
    try {
      await setModules(withModule(modulesOf(session), entry.id, on));
    } catch (err) {
      setError(toUiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={`module-detail__story is-${relation}`} aria-labelledby={`${id}-title`}>
      <h4 id={`${id}-title`} className="eyebrow">
        {t('library.sections.story')}
      </h4>
      <p className="module-detail__story-text">{text}</p>
      {kept && <p className="module-detail__story-note">{t('library.story.kept')}</p>}
      {switchable && (
        <>
          <label className="switch">
            <input
              type="checkbox"
              role="switch"
              className="switch__input"
              checked={relation === 'on'}
              disabled={running || saving}
              onChange={(event) => void toggle(event.target.checked)}
            />
            <span className="switch__track" aria-hidden="true" />
            <span className="switch__label">{t('library.story.switchLabel')}</span>
          </label>
          <p className="module-detail__story-note">{running ? t('modules.busy') : t('modules.nextTurn')}</p>
        </>
      )}
      {error && (
        <div className="form-error" role="alert">
          <p className="form-error__title">{t('modules.failed')}</p>
          <p>{describeError(t, error)}</p>
        </div>
      )}
    </section>
  );
}

interface ModuleDetailProps {
  entry: ModuleLibraryEntry;
  subscribed: readonly ModuleId[];
  /** The largest cost of any module, for the comparison bars. */
  largestCost: number;
  session: Session | null;
  headingRef?: Ref<HTMLHeadingElement>;
  onRemoved?: () => void;
}

/**
 * One module in full: what it is for and what it changes about a story, what
 * it gives the game master, what the player sees, what it costs, and the
 * action to subscribe or unsubscribe, worded with its exact consequences.
 */
export function ModuleDetail({ entry, subscribed, largestCost, session, headingRef, onRemoved }: ModuleDetailProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const uiTag = languageTag(locale);
  const setSubscribed = useLibrary((s) => s.setSubscribed);
  const removePlugin = useLibrary((s) => s.removePlugin);
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const module = entry.id;
  const plugin = entry.plugin;
  const isSubscribed = subscribed.includes(module);
  const view = (MODULE_VIEWS as readonly string[]).includes(module) ? (module as ModuleView) : null;

  // Another module is another action.
  useEffect(() => {
    setError(null);
    setConfirmRemove(false);
  }, [module]);

  const onRemove = async () => {
    setRemoving(true);
    setError(null);
    try {
      if (isSubscribed) await setSubscribed(module, false);
      await removePlugin(module);
      onRemoved?.();
    } catch (err) {
      setError(toUiError(err));
      setRemoving(false);
    }
  };

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      await setSubscribed(module, !isSubscribed);
    } catch (err) {
      setError(toUiError(err));
    } finally {
      setBusy(false);
    }
  };

  let action: string;
  if (busy) action = isSubscribed ? t('library.unsubscribing') : t('library.subscribing');
  else action = isSubscribed ? t('library.unsubscribe') : t('library.subscribe');

  return (
    <article className="module-detail" aria-labelledby={`${id}-name`}>
      <header className="module-detail__head">
        <ModuleGlyph id={module} category={entry.category} glyph={plugin?.glyph} size="large" />
        <div className="module-detail__heading">
          <h3 id={`${id}-name`} ref={headingRef} tabIndex={-1} className="module-detail__name">
            {plugin ? plugin.name[locale] : t(`modules.names.${module}`)}
          </h3>
          <p className="module-detail__tags">
            <span className="tag">{t(`modules.categories.${entry.category}`)}</span>
            {plugin && <span className="tag">{t('library.plugin.badge')}</span>}
            {isSubscribed ? (
              <span className="tag tag--accent">
                <Icon name="check" size={12} />
                {t('library.subscribed')}
              </span>
            ) : (
              <span className="tag">{t('library.notSubscribed')}</span>
            )}
          </p>
          <p className="module-detail__tagline">
            {plugin ? plugin.tagline[locale] : t(`modules.taglines.${module}`)}
          </p>
        </div>
      </header>

      <div className="module-detail__action">
        <button
          type="button"
          className={isSubscribed ? 'btn' : 'btn btn--primary'}
          disabled={busy}
          aria-describedby={`${id}-consequence`}
          onClick={() => void toggle()}
        >
          {!isSubscribed && !busy && <Icon name="plus" size={16} />}
          {action}
        </button>
        <p id={`${id}-consequence`} className="module-detail__consequence">
          {isSubscribed ? t('library.unsubscribeHint') : t('library.subscribeHint')}
        </p>
        {error && (
          <div className="form-error" role="alert">
            <p className="form-error__title">{t('library.subscribeFailed')}</p>
            <p>{describeError(t, error)}</p>
          </div>
        )}
      </div>

      {session && <StoryUse session={session} entry={entry} subscribed={subscribed} />}

      <section className="module-detail__section" aria-labelledby={`${id}-purpose`}>
        <h4 id={`${id}-purpose`} className="eyebrow">
          {t('library.sections.purpose')}
        </h4>
        <p className="module-detail__text">
          {plugin ? plugin.description[locale] : t(`library.about.${module}.purpose`)}
        </p>
        {!plugin && <p className="module-detail__text">{t(`library.about.${module}.effect`)}</p>}
      </section>

      <section className="module-detail__section" aria-labelledby={`${id}-gives`}>
        <h4 id={`${id}-gives`} className="eyebrow">
          {t('library.sections.gives')}
        </h4>
        <dl className="module-facts">
          <div className="module-facts__row">
            <dt>{t('library.gives.tools')}</dt>
            <dd>
              {entry.tools.length > 0 ? (
                <ul className="module-tools">
                  {entry.tools.map((tool) => (
                    <li key={tool}>
                      <code className="module-tools__name">{tool}</code>
                      {plugin?.tools[tool] ? (
                        <span className="module-tools__desc">{plugin.tools[tool].description[locale]}</span>
                      ) : (
                        isKnownTool(tool) && <span className="module-tools__desc">{t(`library.tools.${tool}`)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                t('library.gives.noTools')
              )}
            </dd>
          </div>
          <div className="module-facts__row">
            <dt>{t('library.gives.record')}</dt>
            <dd>
              {plugin
                ? (plugin.recordDescription?.[locale] ?? t('library.gives.noTools'))
                : t(`library.about.${module}.record`)}
            </dd>
          </div>
          <div className="module-facts__row">
            <dt>{t('library.gives.characters')}</dt>
            <dd>
              <span className={entry.reachesCharacters ? 'tag tag--accent' : 'tag'}>
                {entry.reachesCharacters ? t('library.gives.reaches') : t('library.gives.reachesNot')}
              </span>{' '}
              {!plugin && t(`library.about.${module}.characters`)}
            </dd>
          </div>
        </dl>
      </section>

      {!plugin ? (
        <section className="module-detail__section" aria-labelledby={`${id}-sees`}>
          <h4 id={`${id}-sees`} className="eyebrow">
            {t('library.sections.sees')}
          </h4>
          {entry.hasPanel && view && (
            <p className="module-detail__tags">
              <span className="tag">
                {t('library.sees.panel')} · {t(`world.tabs.${view}`)}
              </span>
            </p>
          )}
          <p className="module-detail__text">{t(`library.about.${module}.sees`)}</p>
        </section>
      ) : (
        entry.hasPanel && (
          <section className="module-detail__section" aria-labelledby={`${id}-sees`}>
            <h4 id={`${id}-sees`} className="eyebrow">
              {t('library.sections.sees')}
            </h4>
            <p className="module-detail__tags">
              <span className="tag">
                {t('library.sees.panel')} · {plugin.name[locale]}
              </span>
            </p>
            <p className="module-detail__text">{t('library.plugin.panelNote')}</p>
          </section>
        )
      )}

      <section className="module-detail__section" aria-labelledby={`${id}-cost`}>
        <h4 id={`${id}-cost`} className="eyebrow">
          {t('library.sections.cost')}
        </h4>
        <p className="module-detail__text">{t('library.cost.lead')}</p>
        <ul className="module-cost" aria-label={t('library.cost.barLabel')}>
          {LOCALES.map((locale) => {
            const tokens = Math.max(entry.promptTokens?.[locale] ?? 0, 0);
            return (
              <li key={locale} className="module-cost__row">
                <span className="module-cost__label">{t('library.cost.storyIn', { language: t(`lang.name.${locale}`) })}</span>
                <span className="module-cost__bar" aria-hidden="true">
                  <span style={{ width: `${largestCost > 0 ? (tokens / largestCost) * 100 : 0}%` }} />
                </span>
                <span className="module-cost__value">{t('library.cost.tokens', { n: formatNumber(roughly(tokens), uiTag) })}</span>
              </li>
            );
          })}
        </ul>
        <p className="module-detail__note">{t('library.cost.estimate')}</p>
      </section>

      {plugin && (
        <section className="module-detail__section module-detail__danger" aria-labelledby={`${id}-manage`}>
          <h4 id={`${id}-manage`} className="eyebrow">
            {t('library.plugin.manageHeading')}
          </h4>
          <p className="module-detail__note">{t('library.plugin.uninstallHint')}</p>
          {confirmRemove ? (
            <div className="module-detail__confirm">
              <button
                type="button"
                className="btn btn--danger btn--small"
                disabled={removing}
                onClick={() => void onRemove()}
              >
                <Icon name="trash" size={14} />
                {removing ? t('library.plugin.uninstalling') : t('library.plugin.uninstallConfirm')}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--small"
                disabled={removing}
                onClick={() => setConfirmRemove(false)}
              >
                {t('common.cancel')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn--ghost btn--small module-detail__uninstall"
              disabled={busy || removing}
              onClick={() => setConfirmRemove(true)}
            >
              <Icon name="trash" size={14} />
              {t('library.plugin.uninstall')}
            </button>
          )}
        </section>
      )}
    </article>
  );
}
