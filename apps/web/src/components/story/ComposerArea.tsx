import type { Session } from '@roleplay/shared';
import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { languageTag, useLocale } from '../../i18n';
import { bondOf } from '../../lib/bonds';
import { primaryStandingOf } from '../../lib/characterRoles';
import { COMPOSER_INPUT_ID } from '../../lib/composer';
import { formatNumber } from '../../lib/text';
import { canTalkTo } from '../../lib/world';
import { portraitKey, useGame } from '../../store/game';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import { Icon } from '../Icon';
import { ModelPickerPopover } from '../ModelPickerPopover';
import { BondBadge } from '../world/BondMeter';
import { ModulesMenu } from './ModulesMenu';

function compactTokens(n: number, uiTag: string): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return formatNumber(n, uiTag);
}

/** Suggested actions, who the player is speaking to, and the input box. */
export function ComposerArea({ session }: { session: Session }) {
  const { t } = useTranslation();
  const uiTag = languageTag(useLocale());
  const running = useGame((s) => s.turn !== null);
  const historyBusy = useGame((s) => s.historyBusy);
  const draft = useGame((s) => s.drafts[session.id] ?? '');
  const talkingTo = useGame((s) => s.talkingTo);
  const setDraft = useGame((s) => s.setDraft);
  const sendAction = useGame((s) => s.sendAction);
  const sendTalk = useGame((s) => s.sendTalk);
  const stopTalking = useGame((s) => s.stopTalking);
  const stop = useGame((s) => s.stop);
  const undoTurn = useGame((s) => s.undoTurn);
  const rerollTurn = useGame((s) => s.rerollTurn);
  const forkSession = useGame((s) => s.forkSession);
  const paintCharacterPortrait = useGame((s) => s.paintCharacterPortrait);
  const paintingCharacters = useGame((s) => s.paintingCharacters);
  const illustrationsActive = useSettings((s) => s.settings?.illustrationsActive ?? false);
  const openLightbox = useUi((s) => s.openLightbox);
  const openDossier = useUi((s) => s.openDossier);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);

  const storyLang = languageTag(session.language);
  const notStarted = session.world.turn === 0 && session.messages.length === 0;
  const suggestions = running || notStarted ? [] : session.world.suggestions.filter((s) => s.trim() !== '');
  const canSend = !running && !historyBusy && !notStarted && draft.trim() !== '';
  const hasPrevSnapshot = Boolean(session.snapshots?.some((s) => s.turn === session.world.turn - 1));
  const canUndoOrReroll = !running && !historyBusy && session.world.turn >= 1 && hasPrevSnapshot;
  const canBranch = !running && !historyBusy && session.world.turn >= 1;

  const usage = session.usage;
  const totalTokens = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
  const cachePct =
    usage && usage.inputTokens > 0 ? Math.round((usage.cachedInputTokens / usage.inputTokens) * 100) : 0;
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

        {partner && (() => {
          const standing = primaryStandingOf(session.world, partner);
          const bond = bondOf(session.world, partner.id);
          const paintingPartner = Boolean(paintingCharacters[portraitKey(session.id, partner.id)]);
          const partnerInitial = Array.from(partner.name.trim())[0]?.toUpperCase() ?? '?';
          return (
            <div className="talk-stage">
              <div className={`talk-stage__portrait${paintingPartner ? ' is-painting' : ''}`}>
                {partner.imageUrl ? (
                  <button
                    type="button"
                    className="talk-stage__img-btn"
                    aria-label={t('story.viewLarger')}
                    onClick={() =>
                      openLightbox({ url: partner.imageUrl!, caption: partner.name, lang: storyLang })
                    }
                  >
                    <img src={partner.imageUrl} alt={t('world.portraitOf', { name: partner.name })} />
                  </button>
                ) : illustrationsActive ? (
                  <button
                    type="button"
                    className="talk-stage__paint-btn"
                    disabled={paintingPartner}
                    title={t('world.dossier.paintPortrait')}
                    aria-label={t('world.dossier.paintFor', { name: partner.name })}
                    onClick={() => void paintCharacterPortrait(partner.id)}
                  >
                    <span className="talk-stage__initial" aria-hidden="true">
                      {partnerInitial}
                    </span>
                    <span className="talk-stage__sparkle" aria-hidden="true">
                      <Icon name="sparkle" size={12} />
                    </span>
                  </button>
                ) : (
                  <div className="talk-stage__monogram" aria-hidden="true">
                    <span className="talk-stage__initial">{partnerInitial}</span>
                  </div>
                )}
              </div>

              <div className="talk-stage__main">
                <div className="talk-stage__head">
                  <span className="talk-stage__title">
                    {t('story.speakingTo', { name: partner.name })}
                  </span>
                  {standing && (
                    <span className="talk-stage__standing" lang={storyLang}>
                      {standing}
                    </span>
                  )}
                </div>
                {(partner.attitude || partner.status || bond) && (
                  <div className="talk-stage__facts">
                    {partner.attitude && (
                      <span className="talk-stage__chip" lang={storyLang}>
                        {partner.attitude}
                      </span>
                    )}
                    {partner.status && (
                      <span className="talk-stage__chip talk-stage__chip--muted" lang={storyLang}>
                        {partner.status}
                      </span>
                    )}
                    {bond && <BondBadge score={bond.score} name={partner.name} />}
                  </div>
                )}
              </div>

              <div className="talk-stage__actions">
                <button
                  type="button"
                  className="talk-bar__stop"
                  onClick={() => openDossier(partner.id)}
                >
                  <Icon name="dossier" size={14} />
                  <span>{t('world.dossier.open')}</span>
                </button>
                <button
                  type="button"
                  className="talk-bar__stop"
                  onClick={() => {
                    stopTalking();
                    textareaRef.current?.focus();
                  }}
                >
                  <Icon name="close" size={14} />
                  <span>{t('story.actInstead')}</span>
                </button>
              </div>
            </div>
          );
        })()}

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
          <div className="composer__meta-left">
            <ModelPickerPopover usage={session.usage} disabled={running} />
            <ModulesMenu session={session} />
            {session.world.turn >= 1 && (
              <div className="composer__turn-actions" role="group" aria-label={t('story.turnActionsLabel')}>
                <button
                  type="button"
                  className="composer__action-btn"
                  disabled={!canUndoOrReroll}
                  title={t('story.undoHint')}
                  onClick={() => void undoTurn()}
                >
                  <Icon name="undo" size={14} />
                  <span>{t('story.undo')}</span>
                </button>
                <button
                  type="button"
                  className="composer__action-btn"
                  disabled={!canUndoOrReroll}
                  title={t('story.rerollHint')}
                  onClick={() => void rerollTurn()}
                >
                  <Icon name="retry" size={14} />
                  <span>{t('story.reroll')}</span>
                </button>
                <button
                  type="button"
                  className="composer__action-btn"
                  disabled={!canBranch}
                  title={t('story.branchHint')}
                  onClick={() => void forkSession()}
                >
                  <Icon name="branch" size={14} />
                  <span>{t('story.branchShort')}</span>
                </button>
              </div>
            )}
          </div>
          <div className="composer__meta-right">
            {usage && totalTokens > 0 && (
              <span
                className="composer__usage"
                title={t('story.usageTooltip', {
                  input: formatNumber(usage.inputTokens, uiTag),
                  output: formatNumber(usage.outputTokens, uiTag),
                  cached: formatNumber(usage.cachedInputTokens, uiTag),
                  lastInput: formatNumber(usage.lastTurn?.inputTokens ?? 0, uiTag),
                  lastOutput: formatNumber(usage.lastTurn?.outputTokens ?? 0, uiTag),
                })}
              >
                {cachePct > 0
                  ? t('story.usageWithCache', { tokens: compactTokens(totalTokens, uiTag), cache: cachePct })
                  : t('story.usageTokens', { tokens: compactTokens(totalTokens, uiTag) })}
              </span>
            )}
            <p id="composer-hint" className="composer__hint">
              {t('story.composerHint')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
