import { OFFICIAL_SHORTCUTS, PROVIDER_KINDS, type ModelListTarget, type PublicSettings } from '@roleplay/shared';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { toUiError, type UiError } from '../../api/errors';
import { describeError } from '../../lib/describe';
import { useSettings } from '../../store/settings';
import { IllustrationSection } from './IllustrationSection';
import type { ModelFetch } from './ModelField';
import { AnthropicSection, OpenAISection, type ModelListProps } from './ProviderSections';
import {
  applyToForm,
  formFromSettings,
  formToUpdate,
  modelListNeedsSave,
  type SettingsFormState,
} from './formState';

type Shortcut = keyof typeof OFFICIAL_SHORTCUTS;
const SHORTCUTS: Shortcut[] = ['claude', 'openai'];

const IDLE: Record<ModelListTarget, ModelFetch> = {
  anthropic: { status: 'idle' },
  'openai-compatible': { status: 'idle' },
  image: { status: 'idle' },
};

interface SettingsFormProps {
  settings: PublicSettings;
  header: ReactNode;
  onClose: () => void;
}

export function SettingsForm({ settings, header, onClose }: SettingsFormProps) {
  const { t } = useTranslation();
  const save = useSettings((s) => s.save);
  const id = useId();
  const anthropicKeyId = `${id}-anthropic-key`;
  const openaiKeyId = `${id}-openai-key`;

  const [form, setForm] = useState<SettingsFormState>(() => formFromSettings(settings));
  const [models, setModels] = useState(IDLE);
  const [applied, setApplied] = useState<Shortcut | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  // The key field of a provider only exists once that provider is selected, so focus after render.
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    if (!pendingFocus.current) return;
    document.getElementById(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  });

  const patch = <K extends 'anthropic' | 'openai' | 'image'>(section: K, value: Partial<SettingsFormState[K]>) =>
    setForm((current) => ({ ...current, [section]: { ...current[section], ...value } }));

  const applyShortcut = (shortcut: Shortcut) => {
    setForm((current) => applyToForm(current, OFFICIAL_SHORTCUTS[shortcut]));
    setApplied(shortcut);
    pendingFocus.current = shortcut === 'claude' ? anthropicKeyId : openaiKeyId;
  };

  const persist = async (): Promise<PublicSettings | null> => {
    setBusy(true);
    setError(null);
    try {
      return await save(formToUpdate(form));
    } catch (err) {
      setError(toUiError(err));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (await persist()) onClose();
  };

  const fetchModels = async (target: ModelListTarget) => {
    if (modelListNeedsSave(form, settings, target)) {
      const saved = await persist();
      if (!saved) return;
      setForm(formFromSettings(saved));
    }
    setModels((current) => ({ ...current, [target]: { status: 'loading' } }));
    try {
      const response = await api.listModels(target);
      const list = Array.isArray(response.models) ? response.models.filter((m) => typeof m === 'string') : [];
      setModels((current) => ({ ...current, [target]: { status: 'ready', models: list } }));
    } catch (err) {
      setModels((current) => ({ ...current, [target]: { status: 'error', error: toUiError(err) } }));
    }
  };

  const modelProps = (target: ModelListTarget): ModelListProps => ({
    fetch: models[target],
    needsSave: modelListNeedsSave(form, settings, target),
    busy,
    onFetch: () => void fetchModels(target),
  });

  return (
    <form className="dialog" onSubmit={(event) => void submit(event)}>
      {header}

      <div className="dialog__body">
        <section className="quick-setup" aria-labelledby={`${id}-quick`}>
          <h3 id={`${id}-quick`} className="field__label">
            {t('settings.quickSetup')}
          </h3>
          <div className="quick-setup__buttons">
            {SHORTCUTS.map((shortcut) => (
              <button key={shortcut} type="button" className="btn quick-setup__button" onClick={() => applyShortcut(shortcut)}>
                {t(`settings.shortcuts.${shortcut}`)}
              </button>
            ))}
          </div>
          <p className="field__hint" role="status">
            {applied ? t(`settings.shortcutApplied.${applied}`) : t('settings.quickSetupHint')}
          </p>
        </section>

        <fieldset className="field">
          <legend className="field__label">{t('settings.providerLegend')}</legend>
          <div className="provider-options">
            {PROVIDER_KINDS.map((kind) => (
              <label key={kind} className="provider-option">
                <input
                  type="radio"
                  className="provider-option__input"
                  name={`${id}-provider`}
                  value={kind}
                  checked={form.provider === kind}
                  onChange={() => setForm((current) => ({ ...current, provider: kind }))}
                />
                <span className="provider-option__body">
                  <span className="provider-option__name">{t(`settings.providers.${kind}.name`)}</span>
                  <span className="provider-option__description">{t(`settings.providers.${kind}.description`)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {form.provider === 'anthropic' && (
          <AnthropicSection
            id={`${id}-anthropic`}
            keyFieldId={anthropicKeyId}
            value={form.anthropic}
            keySource={settings.anthropic.apiKeySource}
            onChange={(value) => patch('anthropic', value)}
            models={modelProps('anthropic')}
          />
        )}
        {form.provider === 'openai-compatible' && (
          <OpenAISection
            id={`${id}-openai`}
            keyFieldId={openaiKeyId}
            value={form.openai}
            keySource={settings.openaiCompatible.apiKeySource}
            onChange={(value) => patch('openai', value)}
            models={modelProps('openai-compatible')}
          />
        )}
        {form.provider === 'mock' && <p className="provider-config provider-config__note">{t('settings.mockNote')}</p>}

        <IllustrationSection
          id={`${id}-image`}
          value={form.image}
          saved={settings}
          onChange={(value) => patch('image', value)}
          models={modelProps('image')}
        />

        {error && (
          <div className="form-error" role="alert">
            <p className="form-error__title">{t('settings.saveFailed')}</p>
            <p>{describeError(t, error)}</p>
          </div>
        )}
      </div>

      <footer className="dialog__foot">
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? t('common.saving') : t('common.save')}
        </button>
      </footer>
    </form>
  );
}
