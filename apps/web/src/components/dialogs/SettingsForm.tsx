import {
  CONNECTION_KINDS,
  OFFICIAL_SHORTCUTS,
  type ConnectionKind,
  type ModelListTarget,
  type PublicSettings,
} from '@roleplay/shared';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { toUiError, type UiError } from '../../api/errors';
import { describeError } from '../../lib/describe';
import { useSettings } from '../../store/settings';
import { AdvancedPanel } from './AdvancedPanel';
import { ConnectionsPanel } from './ConnectionsPanel';
import {
  applyToForm,
  connectionIssue,
  formFromSettings,
  formToUpdate,
  modelListNeedsSave,
  rolesUsing,
  withValidEfforts,
  type ActorForm,
  type ConnectionForm,
  type ImageForm,
  type RoleForm,
  type SettingsFormState,
} from './formState';
import { IllustrationSection } from './IllustrationSection';
import type { ModelFetch, ModelListProps } from './ModelField';
import { RolesPanel } from './RolesPanel';
import { panelId, SettingsTabs, tabId, type TabSpec } from './SettingsTabs';

type Tab = 'roles' | 'connections' | 'illustrations' | 'advanced';
type Shortcut = 'claude' | 'openai' | 'gemini' | 'custom';

const SHORTCUTS: readonly Shortcut[] = ['claude', 'openai', 'gemini', 'custom'];
/** The connection each Quick setup button sets up. */
const SHORTCUT_CONNECTION: Record<Shortcut, ConnectionKind> = {
  claude: 'anthropic',
  openai: 'openai',
  gemini: 'gemini',
  custom: 'custom',
};

const IDLE: Record<ModelListTarget, ModelFetch> = {
  anthropic: { status: 'idle' },
  openai: { status: 'idle' },
  gemini: { status: 'idle' },
  custom: { status: 'idle' },
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

  const [form, setForm] = useState<SettingsFormState>(() => formFromSettings(settings));
  const [tab, setTab] = useState<Tab>('roles');
  const [models, setModels] = useState(IDLE);
  const [applied, setApplied] = useState<Shortcut | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  // A field on another tab only exists after that tab renders, so focus after render.
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    if (!pendingFocus.current) return;
    document.getElementById(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  });

  const fieldId = (kind: ConnectionKind, field: 'key' | 'url' | 'model') => `${id}-conn-${kind}-${field}`;

  const jumpTo = (kind: ConnectionKind, field: 'key' | 'url') => {
    setTab('connections');
    pendingFocus.current = fieldId(kind, field);
  };

  const applyShortcut = (shortcut: Shortcut) => {
    if (shortcut === 'custom') {
      // No official endpoint to fill in: make it the game master and ask for the address.
      setForm((current) => withValidEfforts({ ...current, gameMaster: { ...current.gameMaster, provider: 'custom' } }));
      jumpTo('custom', 'url');
    } else {
      setForm((current) => applyToForm(current, OFFICIAL_SHORTCUTS[shortcut]));
      jumpTo(SHORTCUT_CONNECTION[shortcut], 'key');
    }
    setApplied(shortcut);
  };

  const patchGameMaster = (patch: Partial<RoleForm>) =>
    setForm((current) => withValidEfforts({ ...current, gameMaster: { ...current.gameMaster, ...patch } }));
  const patchActor = (patch: Partial<ActorForm>) =>
    setForm((current) => withValidEfforts({ ...current, actor: { ...current.actor, ...patch } }));
  const patchConnection = (kind: ConnectionKind, patch: Partial<ConnectionForm>) =>
    setForm((current) => ({
      ...current,
      connections: { ...current.connections, [kind]: { ...current.connections[kind], ...patch } },
    }));
  const patchImage = (patch: Partial<ImageForm>) => setForm((current) => ({ ...current, image: { ...current.image, ...patch } }));

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

  const modelList = (target: ModelListTarget): ModelListProps => ({
    fetch: models[target],
    needsSave: modelListNeedsSave(form, settings, target),
    busy,
    onFetch: () => void fetchModels(target),
  });

  // A connection a role depends on that cannot work yet (an optional key aside).
  const connectionsNeedAttention = CONNECTION_KINDS.some((kind) => {
    const issue = connectionIssue(kind, form, settings);
    return rolesUsing(kind, form).length > 0 && (issue === 'noKey' || issue === 'noBaseUrl');
  });

  const tabs: ReadonlyArray<TabSpec<Tab>> = [
    { id: 'roles', label: t('settings.tabs.roles') },
    { id: 'connections', label: t('settings.tabs.connections'), attention: connectionsNeedAttention },
    { id: 'illustrations', label: t('settings.tabs.illustrations') },
    { id: 'advanced', label: t('settings.tabs.advanced') },
  ];

  return (
    <form className="dialog" onSubmit={(event) => void submit(event)}>
      {header}

      <div className="dialog__top">
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
        <SettingsTabs idBase={id} label={t('settings.tabsLabel')} tabs={tabs} selected={tab} onSelect={setTab} />
      </div>

      {/* Keyed by tab so each section opens scrolled to its top. */}
      <div key={tab} className="dialog__body" role="tabpanel" id={panelId(id, tab)} aria-labelledby={tabId(id, tab)}>
        {tab === 'roles' && (
          <RolesPanel
            id={`${id}-roles`}
            form={form}
            saved={settings}
            onGameMaster={patchGameMaster}
            onActor={patchActor}
            modelList={modelList}
            onGoToConnection={(kind) => jumpTo(kind, connectionIssue(kind, form, settings) === 'noBaseUrl' ? 'url' : 'key')}
          />
        )}
        {tab === 'connections' && (
          <ConnectionsPanel form={form} saved={settings} onChange={patchConnection} modelList={modelList} fieldId={fieldId} />
        )}
        {tab === 'illustrations' && (
          <IllustrationSection id={`${id}-image`} value={form.image} saved={settings} onChange={patchImage} models={modelList('image')} />
        )}
        {tab === 'advanced' && (
          <AdvancedPanel
            id={`${id}-advanced`}
            value={form.generation}
            onChange={(generation) => setForm((current) => ({ ...current, generation }))}
          />
        )}
      </div>

      {error && (
        <div className="dialog__error form-error" role="alert">
          <p className="form-error__title">{t('settings.saveFailed')}</p>
          <p>{describeError(t, error)}</p>
        </div>
      )}

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
