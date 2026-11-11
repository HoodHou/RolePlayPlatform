import type { ModuleId, PluginManifest } from '@roleplay/shared';
import { useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toUiError } from '../../api/errors';
import { describeError } from '../../lib/describe';
import { useLibrary } from '../../store/library';
import { Icon } from '../Icon';

const SAMPLE_PLUGIN_MANIFEST: PluginManifest = {
  id: 'sanity',
  category: 'rules',
  glyph: '✦',
  name: {
    en: 'Sanity & Stress',
    zh: '理智与压力',
  },
  tagline: {
    en: 'Track mental strain and roll composure checks under eldritch dread.',
    zh: '追踪角色精神负荷，在不可名状的恐惧面前进行理智检定。',
  },
  description: {
    en: 'Adds a Sanity & Stress ledger to the world panel and gives the game master a d100 composure check when characters witness horror or overwhelming pressure.',
    zh: '在世界面板新增“理智与压力”记录页，并为游戏主持人在角色直面恐怖或高压冲击时提供 d100 理智检定工具。',
  },
  guide: {
    en: 'When the protagonist or key companions face unsettling revelations, supernatural terror, or prolonged strain, call `sanity_roll` to test composure and update `record.sanity` with their current stress (0–10) and mental condition.',
    zh: '当主角或重要同伴遭遇骇人真相、超自然恐惧或长期高压时，调用 `sanity_roll` 进行理智检定，并通过 `record.sanity` 更新其当前压力值（0–10）与精神状态。',
  },
  keptWhenUnused: false,
  reachesCharacters: true,
  record: {
    description: 'Mental stress level and active psychological condition per character or threat.',
    uiDescription: {
      en: 'Tracks stress (0–10) and active condition for each affected character.',
      zh: '记录受影响角色的压力值（0–10）与当前精神状态。',
    },
    fields: [
      {
        key: 'stress',
        label: { en: 'Stress', zh: '压力' },
        type: 'number',
        min: 0,
        max: 10,
      },
      {
        key: 'condition',
        label: { en: 'Condition', zh: '状态' },
        type: 'string',
      },
    ],
  },
  tools: [
    {
      name: 'sanity_roll',
      description: 'Roll 1d100 under a sanity threshold (default 65) when confronting dread or mental shock.',
      kind: 'roll',
      dice: '1d100',
      target: 65,
      rollUnder: true,
      signature: 'sanity_roll(reason, target?)',
      uiDescription: {
        en: 'Rolls 1d100 under the target threshold to test composure.',
        zh: '投掷 1d100 低于目标阈值以检定镇定与理智。',
      },
    },
  ],
};

interface PluginInstallPaneProps {
  onInstalled: (id: ModuleId) => void;
  onCancel: () => void;
}

/**
 * Form inside the Module Library's detail pane for installing or updating an
 * external `PluginManifest` from a `.json` file or pasted JSON.
 */
export function PluginInstallPane({ onInstalled, onCancel }: PluginInstallPaneProps) {
  const { t } = useTranslation();
  const installPlugin = useLibrary((s) => s.installPlugin);
  const setSubscribed = useLibrary((s) => s.setSubscribed);
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);

  const [jsonText, setJsonText] = useState('');
  const [subscribeAfter, setSubscribeAfter] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onLoadSample = () => {
    setJsonText(JSON.stringify(SAMPLE_PLUGIN_MANIFEST, null, 2));
    setError(null);
  };

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const content = await file.text();
      setJsonText(content);
      setError(null);
    } catch {
      setError(t('library.plugin.invalidJson'));
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !jsonText.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      setError(t('library.plugin.invalidJson'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const pluginId = await installPlugin(parsed);
      if (subscribeAfter) {
        await setSubscribed(pluginId, true);
      }
      onInstalled(pluginId);
    } catch (err) {
      const uiErr = toUiError(err);
      setError(uiErr.message || describeError(t, uiErr));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="plugin-install" onSubmit={(e) => void onSubmit(e)} aria-labelledby={`${id}-title`}>
      <header className="plugin-install__head">
        <div>
          <h3 id={`${id}-title`} className="module-detail__name">
            {t('library.plugin.installTitle')}
          </h3>
          <p className="module-detail__tagline">{t('library.plugin.installIntro')}</p>
        </div>
      </header>

      <div className="plugin-install__toolbar">
        <button type="button" className="btn btn--small" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={15} />
          {t('library.plugin.loadFile')}
        </button>
        <button type="button" className="btn btn--ghost btn--small" onClick={onLoadSample}>
          <Icon name="code" size={15} />
          {t('library.plugin.loadSample')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => void onFileChange(e)}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor={`${id}-manifest`}>
          {t('library.plugin.manifestLabel')}
        </label>
        <textarea
          id={`${id}-manifest`}
          className="textarea plugin-install__editor"
          rows={14}
          spellCheck={false}
          value={jsonText}
          placeholder={t('library.plugin.manifestPlaceholder')}
          onChange={(e) => setJsonText(e.target.value)}
        />
        <p className="field__hint">{t('library.plugin.manifestHint')}</p>
      </div>

      <label className="switch">
        <input
          type="checkbox"
          role="switch"
          className="switch__input"
          checked={subscribeAfter}
          onChange={(e) => setSubscribeAfter(e.target.checked)}
        />
        <span className="switch__track" aria-hidden="true" />
        <span className="switch__label">{t('library.plugin.subscribeAfter')}</span>
      </label>

      {error && (
        <div className="form-error" role="alert">
          <p className="form-error__title">{t('library.plugin.installFailed')}</p>
          <p className="plugin-install__error-detail">{error}</p>
        </div>
      )}

      <div className="plugin-install__actions">
        <button type="submit" className="btn btn--primary" disabled={busy || !jsonText.trim()}>
          <Icon name="plus" size={16} />
          {busy ? t('library.plugin.installing') : t('library.plugin.installSubmit')}
        </button>
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
