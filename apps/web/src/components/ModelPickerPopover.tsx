import {
  CHAT_MODEL_PRESETS,
  CONNECTION_DEFAULTS,
  CONNECTION_KINDS,
  formatModelDisplayName,
  PROVIDER_EFFORTS,
  type ConnectionKind,
  type Effort,
  type ModelBadgeKind,
  type ProviderKind,
  type PublicSettings,
  type SessionUsage,
  type TokenUsage,
} from '@roleplay/shared';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { languageTag, useLocale } from '../i18n';
import { formatNumber } from '../lib/text';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';
import { Icon } from './Icon';

interface ModelOption {
  key: string;
  provider: ProviderKind;
  model: string;
  label: string;
  badge?: ModelBadgeKind | 'setup';
  defaultEffort: Effort | null;
  configured: boolean;
}

function isConnectionConfigured(kind: ConnectionKind, settings: PublicSettings): boolean {
  const conn = settings.connections[kind];
  if (!conn) return false;
  if (kind === 'custom') return conn.baseUrl.trim().length > 0;
  return conn.apiKeySource !== 'none';
}

function resolvedActiveModel(settings: PublicSettings): string {
  const { provider, model } = settings.gameMaster;
  if (provider === 'mock') return '';
  if (model.trim()) return model.trim();
  const connModel = settings.connections[provider]?.model.trim();
  if (connModel) return connModel;
  return CONNECTION_DEFAULTS[provider].model;
}

function buildModelOptions(
  settings: PublicSettings | null,
  fetchedModels: Partial<Record<ConnectionKind, string[]>>,
  demoLabel: string,
): ModelOption[] {
  if (!settings) {
    return [
      {
        key: 'mock:',
        provider: 'mock',
        model: '',
        label: demoLabel,
        badge: 'demo',
        defaultEffort: null,
        configured: true,
      },
    ];
  }

  const activeProvider = settings.gameMaster.provider;
  const activeModel = resolvedActiveModel(settings);
  const orderedKinds: ConnectionKind[] = [...CONNECTION_KINDS].sort((a, b) => {
    const aActive = a === activeProvider ? 1 : 0;
    const bActive = b === activeProvider ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    const aConf = isConnectionConfigured(a, settings) ? 1 : 0;
    const bConf = isConnectionConfigured(b, settings) ? 1 : 0;
    return bConf - aConf;
  });

  const anyConfigured = orderedKinds.some((k) => isConnectionConfigured(k, settings));
  const options: ModelOption[] = [];
  const seen = new Set<string>();

  const pushOption = (opt: ModelOption) => {
    if (seen.has(opt.key)) return;
    seen.add(opt.key);
    options.push(opt);
  };

  for (const kind of orderedKinds) {
    const configured = isConnectionConfigured(kind, settings);
    // When at least one provider is configured, keep unconfigured custom endpoints out of the way;
    // still show major providers' flagship top presets so users can discover & switch easily.
    if (!configured && kind === 'custom') continue;

    const connSavedModel = settings.connections[kind].model.trim();
    if (connSavedModel) {
      const presetHit = CHAT_MODEL_PRESETS[kind].find((p) => p.model === connSavedModel);
      pushOption({
        key: `${kind}:${connSavedModel}`,
        provider: kind,
        model: connSavedModel,
        label: formatModelDisplayName(kind, connSavedModel),
        badge: configured ? presetHit?.badge : 'setup',
        defaultEffort: presetHit?.defaultEffort ?? (PROVIDER_EFFORTS[kind].includes('medium') ? 'medium' : null),
        configured,
      });
    }

    if (activeProvider === kind && activeModel) {
      const presetHit = CHAT_MODEL_PRESETS[kind].find((p) => p.model === activeModel);
      pushOption({
        key: `${kind}:${activeModel}`,
        provider: kind,
        model: activeModel,
        label: formatModelDisplayName(kind, activeModel),
        badge: configured ? presetHit?.badge : 'setup',
        defaultEffort: settings.gameMaster.effort ?? presetHit?.defaultEffort ?? null,
        configured,
      });
    }

    const presetsToShow =
      configured || !anyConfigured ? CHAT_MODEL_PRESETS[kind].slice(0, configured ? 5 : 2) : CHAT_MODEL_PRESETS[kind].slice(0, 1);

    for (const preset of presetsToShow) {
      pushOption({
        key: `${kind}:${preset.model}`,
        provider: kind,
        model: preset.model,
        label: preset.label,
        badge: configured ? preset.badge : 'setup',
        defaultEffort: preset.defaultEffort ?? null,
        configured,
      });
    }

    if (configured) {
      const remote = fetchedModels[kind] ?? [];
      for (const remoteId of remote.slice(0, 12)) {
        pushOption({
          key: `${kind}:${remoteId}`,
          provider: kind,
          model: remoteId,
          label: formatModelDisplayName(kind, remoteId),
          defaultEffort: null,
          configured: true,
        });
      }
    }
  }

  pushOption({
    key: 'mock:',
    provider: 'mock',
    model: '',
    label: demoLabel,
    badge: 'demo',
    defaultEffort: null,
    configured: true,
  });

  return options;
}

export interface ModelPickerPopoverProps {
  /** Optional token usage (from current session or AI architect chat) for "View Usage". */
  usage?: SessionUsage | TokenUsage | null;
  disabled?: boolean;
  /** Align popover to left or right edge of pill. Defaults to 'left'. */
  align?: 'left' | 'right';
}

/**
 * Compact `[ Model Name  Effort  ^ ]` pill with an upward floating popover for
 * one-click model & thinking-effort switching, live model refresh, usage view,
 * and quick access to Settings.
 */
export function ModelPickerPopover({ usage, disabled = false, align = 'left' }: ModelPickerPopoverProps) {
  const { t } = useTranslation();
  const uiTag = languageTag(useLocale());
  const settings = useSettings((s) => s.settings);
  const saveSettings = useSettings((s) => s.save);
  const fetchedModels = useSettings((s) => s.fetchedModels);
  const fetchingModels = useSettings((s) => s.fetchingModels);
  const fetchModelsFor = useSettings((s) => s.fetchModelsFor);
  const openDialog = useUi((s) => s.openDialog);

  const id = useId();
  const [open, setOpen] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [showUsage, setShowUsage] = useState(false);
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const activeProvider: ProviderKind = settings?.gameMaster.provider ?? 'mock';
  const activeModel = settings ? resolvedActiveModel(settings) : '';
  const activeEffort = settings?.gameMaster.effort ?? null;
  const activeKey = `${activeProvider}:${activeProvider === 'mock' ? '' : activeModel}`;

  const pillLabel =
    activeProvider === 'mock'
      ? t('modelPicker.demoShort')
      : formatModelDisplayName(activeProvider, activeModel);

  const options = useMemo(
    () => buildModelOptions(settings, fetchedModels, t('modelPicker.demoModel')),
    [settings, fetchedModels, t],
  );

  const isFetchingAny = Object.values(fetchingModels).some(Boolean);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
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

  const selectModel = async (opt: ModelOption, chosenEffort?: Effort | null) => {
    if (saving) return;
    const nextEffort =
      chosenEffort !== undefined
        ? chosenEffort
        : opt.provider === 'mock'
          ? null
          : activeProvider === opt.provider && activeEffort && PROVIDER_EFFORTS[opt.provider].includes(activeEffort)
            ? activeEffort
            : opt.defaultEffort && PROVIDER_EFFORTS[opt.provider].includes(opt.defaultEffort)
              ? opt.defaultEffort
              : null;

    setSaving(true);
    try {
      await saveSettings({
        gameMaster: {
          provider: opt.provider,
          model: opt.model,
          effort: nextEffort,
        },
      });
      setOpen(false);
      setExpandedKey(null);
      if (!opt.configured) {
        openDialog('settings');
      }
    } finally {
      setSaving(false);
    }
  };

  const refreshConfiguredModels = () => {
    if (!settings) return;
    for (const kind of CONNECTION_KINDS) {
      if (isConnectionConfigured(kind, settings)) {
        void fetchModelsFor(kind);
      }
    }
  };

  const totalTokens = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
  const cachePct =
    usage && usage.inputTokens > 0 ? Math.round((usage.cachedInputTokens / usage.inputTokens) * 100) : 0;
  const lastTurn = usage && 'lastTurn' in usage ? usage.lastTurn : undefined;

  return (
    <div className={`model-picker-pop${align === 'right' ? ' is-right' : ''}`} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="model-pill"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={`${id}-popover`}
        title={t('modelPicker.switchHint')}
        onClick={() => {
          setOpen((v) => !v);
          setShowUsage(false);
        }}
      >
        <span className="model-pill__name">{pillLabel}</span>
        {activeEffort && activeProvider !== 'mock' && (
          <span className="model-pill__effort">{t(`settings.effort.levels.${activeEffort}`)}</span>
        )}
        <Icon name="chevron" size={12} className="model-pill__chevron" />
      </button>

      {open && (
        <div
          id={`${id}-popover`}
          className="model-popover"
          role="dialog"
          aria-labelledby={`${id}-head`}
        >
          <div className="model-popover__head">
            <span id={`${id}-head`} className="model-popover__title">
              {t('modelPicker.heading')}
            </span>
            {settings && CONNECTION_KINDS.some((k) => isConnectionConfigured(k, settings)) && (
              <button
                type="button"
                className={`model-popover__refresh${isFetchingAny ? ' is-spinning' : ''}`}
                disabled={isFetchingAny}
                title={t('modelPicker.refreshModels')}
                aria-label={t('modelPicker.refreshModels')}
                onClick={refreshConfiguredModels}
              >
                <Icon name="retry" size={13} />
              </button>
            )}
          </div>

          <ul className="model-popover__list">
            {options.map((opt) => {
              const isActive = opt.key === activeKey;
              const rowEffort = isActive ? activeEffort : opt.defaultEffort;
              const canPickEffort = opt.provider !== 'mock';
              const isExpanded = expandedKey === opt.key;
              const levels = opt.provider !== 'mock' ? PROVIDER_EFFORTS[opt.provider] : [];

              return (
                <li key={opt.key} className={`model-row${isActive ? ' is-active' : ''}`}>
                  <div className="model-row__main">
                    <button
                      type="button"
                      className="model-row__select"
                      disabled={saving}
                      onClick={() => void selectModel(opt)}
                    >
                      <span className="model-row__label">{opt.label}</span>
                      {rowEffort && opt.provider !== 'mock' && (
                        <span className="model-row__effort">{t(`settings.effort.levels.${rowEffort}`)}</span>
                      )}
                      {opt.badge && (
                        <span className={`model-row__badge model-row__badge--${opt.badge}`}>
                          {t(`modelPicker.badges.${opt.badge}`)}
                        </span>
                      )}
                    </button>

                    <div className="model-row__right">
                      {isActive && (
                        <span className="model-row__check" aria-hidden="true">
                          <Icon name="check" size={14} />
                        </span>
                      )}
                      {canPickEffort && (
                        <button
                          type="button"
                          className={`model-row__more${isExpanded ? ' is-open' : ''}`}
                          aria-expanded={isExpanded}
                          aria-label={t('modelPicker.chooseEffortFor', { model: opt.label })}
                          title={t('settings.effort.label')}
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedKey((cur) => (cur === opt.key ? null : opt.key));
                          }}
                        >
                          <Icon name="chevron" size={12} />
                        </button>
                      )}
                    </div>
                  </div>

                  {isExpanded && canPickEffort && (
                    <div className="model-row__efforts" role="group" aria-label={t('settings.effort.label')}>
                      <button
                        type="button"
                        className={`effort-chip${isActive && activeEffort === null ? ' is-selected' : ''}`}
                        disabled={saving}
                        onClick={() => void selectModel(opt, null)}
                      >
                        {t('modelPicker.effortAuto')}
                      </button>
                      {levels.map((lvl) => (
                        <button
                          key={lvl}
                          type="button"
                          className={`effort-chip${isActive && activeEffort === lvl ? ' is-selected' : ''}`}
                          disabled={saving}
                          onClick={() => void selectModel(opt, lvl)}
                        >
                          {t(`settings.effort.levels.${lvl}`)}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="model-popover__foot">
            <button
              type="button"
              className="model-popover__action"
              aria-expanded={showUsage}
              onClick={() => setShowUsage((v) => !v)}
            >
              <span className="model-popover__action-left">
                <Icon name="gauge" size={15} />
                <span>{t('modelPicker.viewUsage')}</span>
              </span>
              <span className="model-popover__action-right">
                {totalTokens > 0 && <span className="model-popover__tokens">{formatNumber(totalTokens, uiTag)}</span>}
                <Icon name="chevron" size={12} className={`model-popover__arrow${showUsage ? ' is-down' : ''}`} />
              </span>
            </button>

            {showUsage && (
              <div className="model-popover__usage">
                {totalTokens > 0 && usage ? (
                  <dl className="usage-grid">
                    <div>
                      <dt>{t('modelPicker.inputTokens')}</dt>
                      <dd>{formatNumber(usage.inputTokens, uiTag)}</dd>
                    </div>
                    <div>
                      <dt>{t('modelPicker.outputTokens')}</dt>
                      <dd>{formatNumber(usage.outputTokens, uiTag)}</dd>
                    </div>
                    <div>
                      <dt>{t('modelPicker.cachedTokens')}</dt>
                      <dd>
                        {formatNumber(usage.cachedInputTokens, uiTag)} ({cachePct}%)
                      </dd>
                    </div>
                    {lastTurn && (
                      <div>
                        <dt>{t('modelPicker.lastTurn')}</dt>
                        <dd>
                          +{formatNumber(lastTurn.inputTokens + lastTurn.outputTokens, uiTag)}
                        </dd>
                      </div>
                    )}
                  </dl>
                ) : (
                  <p className="model-popover__usage-empty">{t('modelPicker.noUsageYet')}</p>
                )}
              </div>
            )}

            <button
              type="button"
              className="model-popover__action"
              onClick={() => {
                setOpen(false);
                openDialog('settings');
              }}
            >
              <span className="model-popover__action-left">
                <Icon name="settings" size={15} />
                <span>{t('modelPicker.configureModels')}</span>
              </span>
              <Icon name="chevron" size={12} className="model-popover__arrow" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
