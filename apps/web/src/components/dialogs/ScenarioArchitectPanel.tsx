import type {
  Locale,
  ModuleId,
  ScenarioBlueprint,
  ScenarioChatMessage,
  SessionUsage,
} from '@roleplay/shared';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type SetStateAction,
} from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { isAbortError, toUiError, type UiError } from '../../api/errors';
import { languageTag } from '../../i18n';
import { describeError } from '../../lib/describe';
import { moduleDisplayName } from '../../lib/modules';
import { useLibrary } from '../../store/library';
import { useUi } from '../../store/ui';
import { Icon } from '../Icon';
import { ModelPickerPopover } from '../ModelPickerPopover';
import { ModuleGlyph } from '../ModuleGlyph';

const STARTER_IDEA_KEYS = ['imperial', 'immortal', 'intrigue', 'cyberpunk'] as const;
const REFINE_IDEA_KEYS = ['stakes', 'secret', 'crossover', 'modules'] as const;

export interface ScenarioArchitectPanelProps {
  language: Locale;
  blueprintTitle: string;
  premise: string;
  playerName: string;
  playerConcept: string;
  activeModules: ModuleId[];
  subscribed: ModuleId[] | null;
  messages: ScenarioChatMessage[];
  setMessages: Dispatch<SetStateAction<ScenarioChatMessage[]>>;
  suggestions: string[];
  setSuggestions: Dispatch<SetStateAction<string[]>>;
  usage: SessionUsage | null;
  setUsage: Dispatch<SetStateAction<SessionUsage | null>>;
  streaming: boolean;
  setStreaming: Dispatch<SetStateAction<boolean>>;
  onApplyBlueprint: (blueprint: ScenarioBlueprint) => void;
  onSwitchToForm: () => void;
}

export function ScenarioArchitectPanel({
  language,
  blueprintTitle,
  premise,
  playerName,
  playerConcept,
  activeModules,
  subscribed,
  messages,
  setMessages,
  suggestions,
  setSuggestions,
  usage,
  setUsage,
  streaming,
  setStreaming,
  onApplyBlueprint,
  onSwitchToForm,
}: ScenarioArchitectPanelProps) {
  const { t } = useTranslation();
  const entries = useLibrary((s) => s.entries);
  const openDialog = useUi((s) => s.openDialog);

  const [input, setInput] = useState('');
  const [streamingReply, setStreamingReply] = useState('');
  const [chatError, setChatError] = useState<UiError | null>(null);
  const [syncedPulse, setSyncedPulse] = useState(false);

  const logRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const composingRef = useRef(false);

  const storyLang = languageTag(language);
  const hasDraft = Boolean(premise.trim() || playerName.trim() || playerConcept.trim());

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    log.scrollTop = log.scrollHeight;
  }, [messages, streamingReply, chatError]);

  const stopGeneration = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setStreamingReply('');
  };

  const resetChat = () => {
    if (streaming) return;
    setMessages([]);
    setSuggestions([]);
    setChatError(null);
    setInput('');
    textareaRef.current?.focus();
  };

  const sendMessage = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || streaming) return;

    const nextMessages: ScenarioChatMessage[] = [...messages, { role: 'user', text }];
    setMessages(nextMessages);
    setInput('');
    setSuggestions([]);
    setChatError(null);
    setStreamingReply('');
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const currentDraft: Partial<ScenarioBlueprint> | undefined = hasDraft
      ? {
          ...(blueprintTitle.trim() ? { title: blueprintTitle.trim() } : {}),
          ...(premise.trim() ? { premise: premise.trim() } : {}),
          ...(playerName.trim() ? { playerName: playerName.trim() } : {}),
          ...(playerConcept.trim() ? { playerConcept: playerConcept.trim() } : {}),
          ...(activeModules.length > 0 ? { modules: activeModules } : {}),
        }
      : undefined;

    try {
      await api.streamScenarioArchitect(
        {
          language,
          messages: nextMessages,
          currentDraft,
          ...(subscribed ? { availableModules: subscribed } : {}),
        },
        (event) => {
          switch (event.type) {
            case 'reply_delta':
              setStreamingReply((prev) => prev + event.text);
              break;
            case 'reply_reset':
              setStreamingReply('');
              break;
            case 'done': {
              setStreamingReply('');
              setMessages((prev) => [...prev, { role: 'assistant', text: event.reply }]);
              setSuggestions(event.suggestions);
              setUsage((prev) => ({
                inputTokens: (prev?.inputTokens ?? 0) + event.usage.inputTokens,
                outputTokens: (prev?.outputTokens ?? 0) + event.usage.outputTokens,
                cachedInputTokens: (prev?.cachedInputTokens ?? 0) + event.usage.cachedInputTokens,
                lastTurn: event.usage,
              }));
              if (event.blueprint) {
                onApplyBlueprint(event.blueprint);
                setSyncedPulse(true);
                window.setTimeout(() => setSyncedPulse(false), 1800);
              }
              break;
            }
            case 'error':
              setChatError({ code: event.error.code, message: event.error.message });
              break;
          }
        },
        controller.signal,
      );
    } catch (err) {
      if (!isAbortError(err)) {
        setChatError(toUiError(err));
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setStreaming(false);
      setStreamingReply('');
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (event.nativeEvent.isComposing || composingRef.current || event.keyCode === 229) return;
    event.preventDefault();
    void sendMessage(input);
  };

  return (
    <div className="architect-studio">
      <section className="architect-chat" aria-label={t('newGame.architect.chatLabel')}>
        <div className="architect-chat__log" ref={logRef}>
          {messages.length === 0 && !streaming ? (
            <div className="architect-welcome">
              <div className="architect-welcome__head">
                <span className="architect-welcome__icon" aria-hidden="true">
                  <Icon name="sparkle" size={18} />
                </span>
                <div>
                  <h3 className="architect-welcome__title">
                    {hasDraft ? t('newGame.architect.refineTitle') : t('newGame.architect.welcomeTitle')}
                  </h3>
                  <p className="architect-welcome__lead">
                    {hasDraft ? t('newGame.architect.refineLead') : t('newGame.architect.welcomeLead')}
                  </p>
                </div>
              </div>

              <div className="architect-starters" role="group" aria-label={t('newGame.architect.startersLabel')}>
                {(hasDraft
                  ? REFINE_IDEA_KEYS.map((key) => ({
                      key,
                      title: t(`newGame.architect.refineIdeas.${key}.title`),
                      prompt: t(`newGame.architect.refineIdeas.${key}.prompt`),
                    }))
                  : STARTER_IDEA_KEYS.map((key) => ({
                      key,
                      title: t(`newGame.architect.starters.${key}.title`),
                      prompt: t(`newGame.architect.starters.${key}.prompt`),
                    }))
                ).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className="architect-starter"
                    onClick={() => void sendMessage(item.prompt)}
                  >
                    <span className="architect-starter__title">{item.title}</span>
                    <span className="architect-starter__desc">{item.prompt}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ul className="architect-messages">
              {messages.map((msg, idx) => (
                <li
                  key={`${idx}:${msg.role}`}
                  className={`architect-msg architect-msg--${msg.role}`}
                  lang={msg.role === 'assistant' ? storyLang : undefined}
                >
                  <span className="architect-msg__role">
                    {msg.role === 'user' ? t('story.you') : t('newGame.architect.assistantName')}
                  </span>
                  <div className="architect-msg__bubble">{msg.text}</div>
                </li>
              ))}

              {streaming && (
                <li className="architect-msg architect-msg--assistant is-streaming" lang={storyLang}>
                  <span className="architect-msg__role">{t('newGame.architect.assistantName')}</span>
                  <div className="architect-msg__bubble">
                    {streamingReply || (
                      <span className="architect-msg__thinking">{t('newGame.architect.thinking')}</span>
                    )}
                  </div>
                </li>
              )}
            </ul>
          )}

          {chatError && (
            <div className="form-error architect-chat__error" role="alert">
              <p className="form-error__title">{t('newGame.architect.failed')}</p>
              <p>{describeError(t, chatError)}</p>
              {(chatError.code === 'not_configured' || chatError.code === 'auth_failed') && (
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() => openDialog('settings')}
                >
                  <Icon name="settings" size={14} />
                  <span>{t('common.openSettings')}</span>
                </button>
              )}
            </div>
          )}

          {!streaming && suggestions.length > 0 && (
            <div className="architect-suggestions" role="group" aria-label={t('newGame.architect.suggestionsLabel')}>
              {suggestions.map((suggestion, index) => (
                <button
                  key={`${index}:${suggestion}`}
                  type="button"
                  className="suggestion"
                  lang={storyLang}
                  onClick={() => void sendMessage(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={`architect-composer${streaming ? ' is-streaming' : ''}`}>
          <textarea
            ref={textareaRef}
            className="architect-composer__input"
            rows={2}
            lang={storyLang}
            value={input}
            placeholder={
              hasDraft ? t('newGame.architect.refinePlaceholder') : t('newGame.architect.inputPlaceholder')
            }
            disabled={streaming}
            data-autofocus
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
          />

          <div className="architect-composer__bar">
            <div className="architect-composer__left">
              <button
                type="button"
                className="architect-composer__plus"
                disabled={streaming || (messages.length === 0 && !input.trim())}
                title={t('newGame.architect.resetChat')}
                aria-label={t('newGame.architect.resetChat')}
                onClick={resetChat}
              >
                <Icon name="plus" size={15} />
              </button>
              <ModelPickerPopover usage={usage} disabled={streaming} />
            </div>

            <div className="architect-composer__right">
              {streaming ? (
                <button
                  type="button"
                  className="composer__button composer__button--stop architect-composer__send"
                  onClick={stopGeneration}
                >
                  <Icon name="stop" size={13} />
                  <span>{t('story.stop')}</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="composer__button architect-composer__send"
                  disabled={!input.trim()}
                  title={t('story.send')}
                  aria-label={t('story.send')}
                  onClick={() => void sendMessage(input)}
                >
                  <Icon name="send" size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      <aside className={`blueprint-card${syncedPulse ? ' is-pulsing' : ''}`} aria-label={t('newGame.architect.blueprintLabel')}>
        <header className="blueprint-card__head">
          <div className="blueprint-card__title-row">
            <span className="eyebrow">{t('newGame.architect.blueprintLabel')}</span>
            {hasDraft && (
              <span className="blueprint-card__synced">
                <Icon name="check" size={12} />
                <span>{t('newGame.architect.syncedBadge')}</span>
              </span>
            )}
          </div>
          <button type="button" className="link-btn blueprint-card__edit" onClick={onSwitchToForm}>
            {t('newGame.architect.editManually')}
          </button>
        </header>

        {hasDraft ? (
          <div className="blueprint-card__body" lang={storyLang}>
            <h4 className="blueprint-card__name">
              {blueprintTitle.trim() || t('newGame.architect.untitledBlueprint')}
            </h4>

            {(playerName.trim() || playerConcept.trim()) && (
              <div className="blueprint-card__section">
                <span className="blueprint-card__label">{t('newGame.architect.protagonistLabel')}</span>
                <p className="blueprint-card__protagonist">
                  {playerName.trim() && <strong>{playerName.trim()}</strong>}
                  {playerName.trim() && playerConcept.trim() && ' · '}
                  {playerConcept.trim() && <span>{playerConcept.trim()}</span>}
                </p>
              </div>
            )}

            {premise.trim() && (
              <div className="blueprint-card__section">
                <span className="blueprint-card__label">{t('newGame.premise')}</span>
                <div className="blueprint-card__premise">
                  {premise
                    .trim()
                    .split(/\n{2,}/)
                    .map((para, idx) => (
                      <p key={idx}>{para}</p>
                    ))}
                </div>
              </div>
            )}

            <div className="blueprint-card__section">
              <span className="blueprint-card__label">{t('newGame.modules')}</span>
              {activeModules.length > 0 ? (
                <ul className="blueprint-card__modules">
                  {activeModules.map((mod) => {
                    const entry = entries?.find((e) => e.id === mod);
                    return (
                      <li key={mod} className="blueprint-module-chip">
                        <ModuleGlyph id={mod} category={entry?.category} glyph={entry?.plugin?.glyph} size="small" />
                        <span>{moduleDisplayName(mod, entries, language, t)}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="field__hint">{t('newGame.modulesAuto')}</p>
              )}
            </div>
          </div>
        ) : (
          <div className="blueprint-card__empty">
            <Icon name="book" size={24} className="blueprint-card__empty-icon" />
            <p className="blueprint-card__empty-title">{t('newGame.architect.emptyBlueprintTitle')}</p>
            <p className="blueprint-card__empty-desc">{t('newGame.architect.emptyBlueprintDesc')}</p>
          </div>
        )}
      </aside>
    </div>
  );
}
