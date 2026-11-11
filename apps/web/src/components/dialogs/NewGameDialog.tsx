import {
  LOCALES,
  type CreateSessionRequest,
  type Locale,
  type ModuleId,
  type ScenarioBlueprint,
  type ScenarioChatMessage,
  type SessionUsage,
} from '@roleplay/shared';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toUiError, type UiError } from '../../api/errors';
import {
  findScenarioPreset,
  SCENARIO_CATEGORIES,
  SCENARIO_PRESETS,
  type PresetId,
  type ScenarioCategory,
  type ScenarioPreset,
} from '../../data/presets';
import { languageTag, useLocale } from '../../i18n';
import { describeError } from '../../lib/describe';
import { moduleDisplayDescription, moduleDisplayName, withModule } from '../../lib/modules';
import { formatList } from '../../lib/text';
import { useGame } from '../../store/game';
import { useLibrary, useSubscriptions } from '../../store/library';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import { Icon } from '../Icon';
import { Modal } from '../Modal';
import { ModuleGlyph } from '../ModuleGlyph';
import { ScenarioArchitectPanel } from './ScenarioArchitectPanel';

type ModuleChoice = 'auto' | 'manual';
type CreationMode = 'form' | 'architect';

/**
 * Leave the modules to the game master (the default), or tick them by hand,
 * none at all included. Either way only modules the player subscribes to are
 * on offer; the library, for more, opens on top of this dialog.
 */
function ModulesField({
  subscribed,
  choice,
  picked,
  onChoice,
  onPick,
}: {
  /** Null while the subscriptions are not known. */
  subscribed: ModuleId[] | null;
  choice: ModuleChoice;
  picked: ModuleId[];
  onChoice: (choice: ModuleChoice) => void;
  onPick: (picked: ModuleId[]) => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const uiTag = languageTag(locale);
  const settingsStatus = useSettings((s) => s.status);
  const entries = useLibrary((s) => s.entries);
  const openLibrary = useUi((s) => s.openLibrary);
  const id = useId();

  const browse = (
    <button type="button" className="link-btn" aria-haspopup="dialog" onClick={() => openLibrary()}>
      {t('newGame.modulesBrowse')}
    </button>
  );

  if (subscribed === null) {
    return (
      <fieldset className="field">
        <legend className="field__label">{t('newGame.modules')}</legend>
        <p className="field__hint" role="status">
          {settingsStatus === 'error' ? t('newGame.modulesUnknown') : t('newGame.modulesLoading')}
        </p>
      </fieldset>
    );
  }

  if (subscribed.length === 0) {
    return (
      <fieldset className="field">
        <legend className="field__label">{t('newGame.modules')}</legend>
        <div className="modules-empty">
          <p>{t('newGame.modulesNoneSubscribed')}</p>
          <button type="button" className="btn btn--small" aria-haspopup="dialog" onClick={() => openLibrary()}>
            <Icon name="modules" size={15} />
            {t('newGame.modulesBrowse')}
          </button>
        </div>
      </fieldset>
    );
  }

  const ticked = picked.filter((module) => subscribed.includes(module));
  const names = formatList(
    subscribed.map((module) => moduleDisplayName(module, entries, locale, t)),
    uiTag,
  );

  return (
    <fieldset className="field">
      <legend className="field__label">{t('newGame.modules')}</legend>
      <div className="segmented">
        {(['auto', 'manual'] as const).map((option) => (
          <label key={option} className="segmented__option">
            <input
              type="radio"
              name={`${id}-modules`}
              value={option}
              checked={choice === option}
              onChange={() => onChoice(option)}
            />
            <span>{option === 'auto' ? t('newGame.modulesAuto') : t('newGame.modulesManual')}</span>
          </label>
        ))}
      </div>
      {choice === 'auto' ? (
        <p className="field__hint">{t('newGame.modulesAutoHint', { list: names })}</p>
      ) : (
        <>
          <ul className="module-options module-options--grid">
            {subscribed.map((module) => {
              const libEntry = entries?.find((e) => e.id === module);
              return (
                <li key={module}>
                  <label className="module-option">
                    <input
                      type="checkbox"
                      className="module-option__input"
                      checked={ticked.includes(module)}
                      aria-describedby={`${id}-${module}`}
                      onChange={(event) => onPick(withModule(ticked, module, event.target.checked))}
                    />
                    <ModuleGlyph id={module} category={libEntry?.category} glyph={libEntry?.plugin?.glyph} size="small" />
                    <span className="module-option__body">
                      <span className="module-option__name">{moduleDisplayName(module, entries, locale, t)}</span>
                      <span id={`${id}-${module}`} className="module-option__desc">
                        {moduleDisplayDescription(module, entries, locale, t)}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className={ticked.length === 0 ? 'field__hint field__hint--warning' : 'field__hint'} aria-live="polite">
            {ticked.length === 0 ? t('newGame.modulesNone') : t('newGame.modulesManualHint')}
          </p>
        </>
      )}
      <p className="field__hint modules-more">
        {choice === 'manual' && <>{t('newGame.modulesSubscribedOnly')} </>}
        {browse}
      </p>
    </fieldset>
  );
}

export function NewGameDialog() {
  const { t } = useTranslation();
  const uiLocale = useLocale();
  const close = useUi((s) => s.closeDialog);
  const createGame = useGame((s) => s.createGame);
  const entries = useLibrary((s) => s.entries);
  const id = useId();

  const [mode, setMode] = useState<CreationMode>('form');
  const [category, setCategory] = useState<ScenarioCategory>('all');
  const [language, setLanguage] = useState<Locale>(uiLocale);
  const [blueprintTitle, setBlueprintTitle] = useState('');
  const [premise, setPremise] = useState('');
  const [preset, setPreset] = useState<PresetId | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [playerConcept, setPlayerConcept] = useState('');
  const [moduleChoice, setModuleChoice] = useState<ModuleChoice>('auto');
  const [pickedModules, setPickedModules] = useState<ModuleId[]>(['dice']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);

  // Persistent AI Scenario Architect session state across tab switches.
  const [chatMessages, setChatMessages] = useState<ScenarioChatMessage[]>([]);
  const [chatSuggestions, setChatSuggestions] = useState<string[]>([]);
  const [architectUsage, setArchitectUsage] = useState<SessionUsage | null>(null);
  const [architectStreaming, setArchitectStreaming] = useState(false);

  const subscribed = useSubscriptions();

  // A module subscribed to from here (the library opens on top of this dialog) is wanted: tick it.
  const known = useRef(subscribed);
  useEffect(() => {
    const before = known.current;
    known.current = subscribed;
    if (!before || !subscribed) return;
    const added = subscribed.filter((module) => !before.includes(module));
    if (added.length > 0) {
      setPickedModules((picked) => added.reduce((list, module) => withModule(list, module, true), picked));
    }
  }, [subscribed]);

  const activePreset = findScenarioPreset(preset);
  const isPresetActive =
    activePreset !== undefined && premise === activePreset.premise[language];

  const choosePreset = (item: ScenarioPreset) => {
    setPreset(item.id);
    setBlueprintTitle(item.title[language]);
    setPremise(item.premise[language]);
    setPlayerName(item.playerName[language]);
    setPlayerConcept(item.playerConcept[language]);

    const matching = subscribed
      ? item.modules.filter((m) => subscribed.includes(m))
      : [...item.modules];
    if (matching.length > 0) {
      setModuleChoice('manual');
      setPickedModules(matching);
    }
  };

  const clearScenario = () => {
    setPreset(null);
    setBlueprintTitle('');
    setPremise('');
    setPlayerName('');
    setPlayerConcept('');
    setModuleChoice('auto');
  };

  const applyBlueprint = (bp: ScenarioBlueprint) => {
    setPreset(null);
    if (bp.title.trim()) setBlueprintTitle(bp.title.trim());
    if (bp.premise.trim()) setPremise(bp.premise.trim());
    if (bp.playerName.trim()) setPlayerName(bp.playerName.trim());
    if (bp.playerConcept.trim()) setPlayerConcept(bp.playerConcept.trim());
    if (bp.modules.length > 0) {
      const valid = subscribed
        ? bp.modules.filter((m) => subscribed.includes(m))
        : bp.modules;
      if (valid.length > 0) {
        setModuleChoice('manual');
        setPickedModules(valid);
      }
    }
  };

  const chooseLanguage = (next: Locale) => {
    if (activePreset) {
      if (premise === activePreset.premise[language]) setPremise(activePreset.premise[next]);
      if (playerName === activePreset.playerName[language]) setPlayerName(activePreset.playerName[next]);
      if (playerConcept === activePreset.playerConcept[language]) setPlayerConcept(activePreset.playerConcept[next]);
      if (blueprintTitle === activePreset.title[language]) setBlueprintTitle(activePreset.title[next]);
    }
    setLanguage(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || architectStreaming) return;
    const request: CreateSessionRequest = { language };
    if (premise.trim()) request.premise = premise.trim();
    if (playerName.trim()) request.playerName = playerName.trim();
    if (playerConcept.trim()) request.playerConcept = playerConcept.trim();
    // Left out, the game master chooses among the subscribed modules; an empty list is a choice too (no
    // modules at all), and the only one there is without a subscription.
    if (subscribed?.length === 0) request.modules = [];
    else if (moduleChoice === 'manual') {
      request.modules = subscribed ? pickedModules.filter((module) => subscribed.includes(module)) : pickedModules;
    }

    setBusy(true);
    setError(null);
    try {
      await createGame(request);
      close();
    } catch (err) {
      setError(toUiError(err));
      setBusy(false);
    }
  };

  const storyLang = languageTag(language);
  const visiblePresets =
    category === 'all'
      ? SCENARIO_PRESETS
      : SCENARIO_PRESETS.filter((item) => item.category === category);

  const effectiveModules =
    moduleChoice === 'manual'
      ? subscribed
        ? pickedModules.filter((m) => subscribed.includes(m))
        : pickedModules
      : [];

  const hasAnyDraft = Boolean(premise.trim() || playerName.trim() || playerConcept.trim());

  return (
    <Modal labelledBy={`${id}-title`} onClose={close} className="modal--new-game">
      <form className="dialog" onSubmit={(event) => void submit(event)}>
        <header className="dialog__head">
          <h2 id={`${id}-title`} className="dialog__title">
            {t('newGame.title')}
          </h2>
          <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={close}>
            <Icon name="close" />
          </button>
        </header>

        <div className="dialog__top new-game__top">
          <div className="new-game__bar">
            <div className="dialog-tabs" role="tablist" aria-label={t('newGame.tabs.label')}>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'form'}
                className="dialog-tabs__tab new-game__tab"
                onClick={() => setMode('form')}
              >
                <Icon name="book" size={15} />
                <span>{t('newGame.tabs.library')}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'architect'}
                className="dialog-tabs__tab new-game__tab"
                onClick={() => setMode('architect')}
              >
                <Icon name="sparkle" size={15} />
                <span>{t('newGame.tabs.architect')}</span>
              </button>
            </div>

            <div className="new-game__lang" role="group" aria-label={t('newGame.storyLanguage')}>
              <span className="new-game__lang-label">{t('newGame.storyLanguage')}</span>
              <div className="segmented segmented--compact">
                {LOCALES.map((option) => (
                  <label key={option} className="segmented__option">
                    <input
                      type="radio"
                      name={`${id}-language`}
                      value={option}
                      checked={language === option}
                      onChange={() => chooseLanguage(option)}
                    />
                    <span lang={languageTag(option)}>{t(`lang.endonym.${option}`)}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className={`dialog__body${mode === 'architect' ? ' dialog__body--architect' : ''}`}>
          {mode === 'form' ? (
            <>
              <section className="scenario-section" aria-labelledby={`${id}-presets-heading`}>
                <div className="scenario-section__head">
                  <div>
                    <h3 id={`${id}-presets-heading`} className="field__label">
                      {t('newGame.scenarioLibrary')}
                    </h3>
                    <p className="field__hint">{t('newGame.intro')}</p>
                  </div>

                  <div className="scenario-cats" role="group" aria-label={t('newGame.categoriesLabel')}>
                    {SCENARIO_CATEGORIES.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        className="chip-button"
                        aria-pressed={category === cat}
                        onClick={() => setCategory(cat)}
                      >
                        {t(`newGame.categories.${cat}`)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="scenario-grid">
                  {visiblePresets.map((item) => {
                    const selected = preset === item.id && isPresetActive;
                    const previewMods = item.modules.slice(0, 3);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`scenario-card${selected ? ' is-selected' : ''}`}
                        aria-pressed={selected}
                        lang={storyLang}
                        onClick={() => choosePreset(item)}
                      >
                        <div className="scenario-card__top">
                          <span className="scenario-card__glyph" aria-hidden="true">
                            {item.glyph}
                          </span>
                          <div className="scenario-card__titles">
                            <span className="scenario-card__title">{item.title[language]}</span>
                            <span className="scenario-card__cat">
                              {t(`newGame.categories.${item.category}`)}
                            </span>
                          </div>
                          {selected && (
                            <span className="scenario-card__check" aria-hidden="true">
                              <Icon name="check" size={14} />
                            </span>
                          )}
                        </div>
                        <p className="scenario-card__tagline">{item.tagline[language]}</p>
                        <div className="scenario-card__foot">
                          <span className="scenario-card__protagonist">
                            {item.playerName[language]}
                          </span>
                          <span className="scenario-card__mods">
                            {previewMods
                              .map((m) => moduleDisplayName(m, entries, language, t))
                              .join(' · ')}
                            {item.modules.length > 3 ? ` +${item.modules.length - 3}` : ''}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              <div className="field">
                <div className="field__label-row">
                  <label className="field__label" htmlFor={`${id}-premise`}>
                    {t('newGame.premise')}
                  </label>
                  <div className="new-game__premise-actions">
                    {hasAnyDraft && (
                      <button
                        type="button"
                        className="link-btn"
                        onClick={clearScenario}
                      >
                        {t('newGame.clearDraft')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="ai-bridge-btn"
                      onClick={() => setMode('architect')}
                    >
                      <Icon name="sparkle" size={13} />
                      <span>{hasAnyDraft ? t('newGame.refineWithAi') : t('newGame.createWithAi')}</span>
                    </button>
                  </div>
                </div>
                <textarea
                  id={`${id}-premise`}
                  className="input input--area"
                  rows={5}
                  lang={storyLang}
                  value={premise}
                  placeholder={t('newGame.premisePlaceholder')}
                  onChange={(event) => setPremise(event.target.value)}
                />
              </div>

              <div className="field-grid">
                <div className="field">
                  <label className="field__label" htmlFor={`${id}-name`}>
                    {t('newGame.playerName')}
                  </label>
                  <input
                    id={`${id}-name`}
                    className="input"
                    type="text"
                    autoComplete="off"
                    lang={storyLang}
                    value={playerName}
                    placeholder={t('newGame.playerNamePlaceholder')}
                    onChange={(event) => setPlayerName(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label className="field__label" htmlFor={`${id}-concept`}>
                    {t('newGame.playerConcept')}
                  </label>
                  <input
                    id={`${id}-concept`}
                    className="input"
                    type="text"
                    autoComplete="off"
                    lang={storyLang}
                    value={playerConcept}
                    placeholder={t('newGame.playerConceptPlaceholder')}
                    onChange={(event) => setPlayerConcept(event.target.value)}
                  />
                </div>
              </div>

              <ModulesField
                subscribed={subscribed}
                choice={moduleChoice}
                picked={pickedModules}
                onChoice={setModuleChoice}
                onPick={setPickedModules}
              />
            </>
          ) : (
            <ScenarioArchitectPanel
              language={language}
              blueprintTitle={blueprintTitle}
              premise={premise}
              playerName={playerName}
              playerConcept={playerConcept}
              activeModules={effectiveModules}
              subscribed={subscribed}
              messages={chatMessages}
              setMessages={setChatMessages}
              suggestions={chatSuggestions}
              setSuggestions={setChatSuggestions}
              usage={architectUsage}
              setUsage={setArchitectUsage}
              streaming={architectStreaming}
              setStreaming={setArchitectStreaming}
              onApplyBlueprint={applyBlueprint}
              onSwitchToForm={() => setMode('form')}
            />
          )}

          {error && (
            <div className="form-error" role="alert">
              <p className="form-error__title">{t('newGame.failed')}</p>
              <p>{describeError(t, error)}</p>
            </div>
          )}
        </div>

        <footer className="dialog__foot new-game__foot">
          <div className="new-game__foot-status">
            {hasAnyDraft && (
              <span className="new-game__ready-pill" lang={storyLang}>
                <Icon name="check" size={13} />
                <span>
                  {blueprintTitle.trim() || playerName.trim() || t('newGame.customScenarioReady')}
                </span>
              </span>
            )}
          </div>
          <div className="new-game__foot-actions">
            <button type="button" className="btn btn--ghost" onClick={close}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy || architectStreaming}>
              {busy ? t('newGame.starting') : t('newGame.start')}
            </button>
          </div>
        </footer>
      </form>
    </Modal>
  );
}
