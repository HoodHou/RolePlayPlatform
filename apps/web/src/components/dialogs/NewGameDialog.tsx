import { LOCALES, type CreateSessionRequest, type Locale, type ModuleId } from '@roleplay/shared';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toUiError, type UiError } from '../../api/errors';
import { PRESET_IDS, PRESET_PREMISES, type PresetId } from '../../data/presets';
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

type ModuleChoice = 'auto' | 'manual';

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
          <ul className="module-options">
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
  const id = useId();

  const [language, setLanguage] = useState<Locale>(uiLocale);
  const [premise, setPremise] = useState('');
  const [preset, setPreset] = useState<PresetId | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [playerConcept, setPlayerConcept] = useState('');
  const [moduleChoice, setModuleChoice] = useState<ModuleChoice>('auto');
  const [pickedModules, setPickedModules] = useState<ModuleId[]>(['dice']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const subscribed = useSubscriptions();

  // A module subscribed to from here (the library opens on top of this dialog) is wanted: tick it.
  const known = useRef(subscribed);
  useEffect(() => {
    const before = known.current;
    known.current = subscribed;
    if (!before || !subscribed) return;
    const added = subscribed.filter((module) => !before.includes(module));
    if (added.length > 0) setPickedModules((picked) => added.reduce((list, module) => withModule(list, module, true), picked));
  }, [subscribed]);

  const presetUntouched = preset !== null && premise === PRESET_PREMISES[preset][language];

  const choosePreset = (next: PresetId) => {
    setPreset(next);
    setPremise(PRESET_PREMISES[next][language]);
  };

  const chooseLanguage = (next: Locale) => {
    // A preset premise the player hasn't edited follows the story language.
    if (presetUntouched) setPremise(PRESET_PREMISES[preset][next]);
    setLanguage(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
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

  return (
    <Modal labelledBy={`${id}-title`} onClose={close}>
      <form className="dialog" onSubmit={(event) => void submit(event)}>
        <header className="dialog__head">
          <h2 id={`${id}-title`} className="dialog__title">
            {t('newGame.title')}
          </h2>
          <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={close}>
            <Icon name="close" />
          </button>
        </header>

        <div className="dialog__body">
          <p className="dialog__intro">{t('newGame.intro')}</p>

          <fieldset className="field">
            <legend className="field__label">{t('newGame.storyLanguage')}</legend>
            <div className="segmented">
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
            <p className="field__hint">{t('newGame.storyLanguageHint')}</p>
          </fieldset>

          <div className="field">
            <label className="field__label" htmlFor={`${id}-premise`}>
              {t('newGame.premise')}
            </label>
            <textarea
              id={`${id}-premise`}
              className="input input--area"
              rows={4}
              lang={storyLang}
              value={premise}
              placeholder={t('newGame.premisePlaceholder')}
              data-autofocus
              onChange={(event) => setPremise(event.target.value)}
            />
            <div className="preset-row" role="group" aria-labelledby={`${id}-presets`}>
              <span id={`${id}-presets`} className="field__hint">
                {t('newGame.presetsLabel')}
              </span>
              {PRESET_IDS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className="chip-button"
                  aria-pressed={preset === option && presetUntouched}
                  onClick={() => choosePreset(option)}
                >
                  {t(`newGame.presets.${option}`)}
                </button>
              ))}
            </div>
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

          {error && (
            <div className="form-error" role="alert">
              <p className="form-error__title">{t('newGame.failed')}</p>
              <p>{describeError(t, error)}</p>
            </div>
          )}
        </div>

        <footer className="dialog__foot">
          <button type="button" className="btn btn--ghost" onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? t('newGame.starting') : t('newGame.start')}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
