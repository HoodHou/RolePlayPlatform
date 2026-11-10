import type { Session } from '@roleplay/shared';
import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { languageTag } from '../../i18n';
import { COMPOSER_INPUT_ID } from '../../lib/composer';
import { canTalkTo } from '../../lib/world';
import { useGame } from '../../store/game';
import { CharacterAvatar } from '../CharacterAvatar';
import { Icon } from '../Icon';
import { ModulesMenu } from './ModulesMenu';

/** Suggested actions, who the player is speaking to, and the input box. */
export function ComposerArea({ session }: { session: Session }) {
  const { t } = useTranslation();
  const running = useGame((s) => s.turn !== null);
  const draft = useGame((s) => s.drafts[session.id] ?? '');
  const talkingTo = useGame((s) => s.talkingTo);
  const setDraft = useGame((s) => s.setDraft);
  const sendAction = useGame((s) => s.sendAction);
  const sendTalk = useGame((s) => s.sendTalk);
  const stopTalking = useGame((s) => s.stopTalking);
  const stop = useGame((s) => s.stop);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);

  const storyLang = languageTag(session.language);
  const notStarted = session.world.turn === 0 && session.messages.length === 0;
  const suggestions = running || notStarted ? [] : session.world.suggestions.filter((s) => s.trim() !== '');
  const canSend = !running && !notStarted && draft.trim() !== '';
  // The store clears `talkingTo` when they leave; checking here as well keeps a stale id from ever being sent.
  const partner = talkingTo && canTalkTo(session.world, talkingTo) ? session.world.characters[talkingTo] : undefined;

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
    if (partner) sendTalk(text);
    else sendAction(text);
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
                    // Suggestions are story actions, even mid-conversation.
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

        {partner && (
          <div className="talk-bar">
            <CharacterAvatar name={partner.name} imageUrl={partner.imageUrl} size="small" />
            <span className="talk-bar__label">
              {t('story.speakingTo', { name: partner.name })}
            </span>
            <button
              type="button"
              className="talk-bar__stop"
              onClick={() => {
                stopTalking();
                textareaRef.current?.focus();
              }}
            >
              <Icon name="close" size={14} />
              {t('story.actInstead')}
            </button>
          </div>
        )}

        <form
          className={`composer${running ? ' is-running' : ''}${partner ? ' is-talking' : ''}`}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label className="sr-only" htmlFor={COMPOSER_INPUT_ID}>
            {partner ? t('story.speakingTo', { name: partner.name }) : t('story.composerLabel')}
          </label>
          <textarea
            id={COMPOSER_INPUT_ID}
            ref={textareaRef}
            className="composer__input"
            rows={1}
            lang={storyLang}
            value={draft}
            placeholder={
              partner ? t('story.composerTalkPlaceholder', { name: partner.name }) : t('story.composerPlaceholder')
            }
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
        <div className="composer__meta">
          <ModulesMenu session={session} />
          <p id="composer-hint" className="composer__hint">
            {t('story.composerHint')}
          </p>
        </div>
      </div>
    </div>
  );
}
