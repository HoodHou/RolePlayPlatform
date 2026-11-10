import type { Session } from '@roleplay/shared';
import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { languageTag } from '../../i18n';
import { useGame } from '../../store/game';
import { Icon } from '../Icon';

/** Suggested actions plus the input box. */
export function ComposerArea({ session }: { session: Session }) {
  const { t } = useTranslation();
  const running = useGame((s) => s.turn !== null);
  const draft = useGame((s) => s.drafts[session.id] ?? '');
  const setDraft = useGame((s) => s.setDraft);
  const sendAction = useGame((s) => s.sendAction);
  const stop = useGame((s) => s.stop);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);

  const storyLang = languageTag(session.language);
  const notStarted = session.world.turn === 0 && session.messages.length === 0;
  const suggestions = running || notStarted ? [] : session.world.suggestions.filter((s) => s.trim() !== '');
  const canSend = !running && !notStarted && draft.trim() !== '';

  // Grow with the text up to the CSS max-height.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  const submit = () => {
    if (!canSend) return;
    const text = draft.trim();
    setDraft('');
    sendAction(text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    // Enter also confirms an IME candidate (Chinese, Japanese…); that must not send.
    // Safari reports such keydowns with isComposing=false but keyCode 229.
    if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
    event.preventDefault();
    submit();
  };

  return (
    <div className="composer-area">
      <div className="composer-area__inner">
        {suggestions.length > 0 && (
          <ul className="suggestions" aria-label={t('story.suggestionsLabel')}>
            {suggestions.map((suggestion, index) => (
              <li key={`${index}:${suggestion}`}>
                <button
                  type="button"
                  className="suggestion"
                  lang={storyLang}
                  onClick={() => {
                    sendAction(suggestion);
                    textareaRef.current?.focus();
                  }}
                >
                  {suggestion}
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          className={running ? 'composer is-running' : 'composer'}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label className="sr-only" htmlFor="composer-input">
            {t('story.composerLabel')}
          </label>
          <textarea
            id="composer-input"
            ref={textareaRef}
            className="composer__input"
            rows={1}
            lang={storyLang}
            value={draft}
            placeholder={t('story.composerPlaceholder')}
            disabled={notStarted && !running}
            aria-describedby="composer-hint"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
          />
          {running ? (
            <button type="button" className="composer__button composer__button--stop" onClick={stop}>
              <Icon name="stop" size={14} />
              <span>{t('story.stop')}</span>
            </button>
          ) : (
            <button type="submit" className="composer__button" disabled={!canSend} aria-label={t('story.send')} title={t('story.send')}>
              <Icon name="send" size={18} />
            </button>
          )}
        </form>
        <p id="composer-hint" className="composer__hint">
          {t('story.composerHint')}
        </p>
      </div>
    </div>
  );
}
