import { LOCALES, type CreateSessionRequest, type Locale } from '@roleplay/shared';
import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toUiError, type UiError } from '../../api/errors';
import { PRESET_IDS, PRESET_PREMISES, type PresetId } from '../../data/presets';
import { languageTag, useLocale } from '../../i18n';
import { describeError } from '../../lib/describe';
import { useGame } from '../../store/game';
import { useUi } from '../../store/ui';
import { Icon } from '../Icon';
import { Modal } from '../Modal';

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);

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
