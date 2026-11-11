import {
  CONNECTION_DEFAULTS,
  formatContextWindow,
  resolveModelContextWindow,
  type DialogueMessage,
  type ModuleDirective,
  type Session,
} from '@roleplay/shared';
import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { languageTag, useLocale } from '../../i18n';
import { bondOf } from '../../lib/bonds';
import { primaryStandingOf } from '../../lib/characterRoles';
import { COMPOSER_INPUT_ID } from '../../lib/composer';
import { MODULE_GLYPH } from '../../lib/modules';
import { formatNumber } from '../../lib/text';
import { canTalkTo } from '../../lib/world';
import { portraitKey, useGame } from '../../store/game';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import { Icon } from '../Icon';
import { ModelPickerPopover } from '../ModelPickerPopover';
import { BondBadge } from '../world/BondMeter';
import { ModulesMenu } from './ModulesMenu';

const EMPTY_DIRECTIVES: readonly ModuleDirective[] = [];

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
  const moduleBusy = useGame((s) => s.moduleBusy);
  const draft = useGame((s) => s.drafts[session.id] ?? '');
  const staged = useGame((s) => s.stagedDirectives[session.id] ?? EMPTY_DIRECTIVES);
  const talkingTo = useGame((s) => s.talkingTo);
  const setDraft = useGame((s) => s.setDraft);
  const sendAction = useGame((s) => s.sendAction);
  const sendTalk = useGame((s) => s.sendTalk);
  const stageDirective = useGame((s) => s.stageDirective);
  const removeDirective = useGame((s) => s.removeDirective);
  const clearDirectives = useGame((s) => s.clearDirectives);
  const stopTalking = useGame((s) => s.stopTalking);
  const stop = useGame((s) => s.stop);
  const undoTurn = useGame((s) => s.undoTurn);
  const rerollTurn = useGame((s) => s.rerollTurn);
  const forkSession = useGame((s) => s.forkSession);
  const paintCharacterPortrait = useGame((s) => s.paintCharacterPortrait);
  const paintingCharacters = useGame((s) => s.paintingCharacters);
  const settings = useSettings((s) => s.settings);
  const illustrationsActive = settings?.illustrationsActive ?? false;
  const openLightbox = useUi((s) => s.openLightbox);
  const openDossier = useUi((s) => s.openDossier);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);

  const storyLang = languageTag(session.language);
  const notStarted = session.world.turn === 0 && session.messages.length === 0;
  const suggestions = running || notStarted ? [] : session.world.suggestions.filter((s) => s.trim() !== '');
  // The store clears `talkingTo` when they leave; checking here as well keeps a stale id from ever being sent.
  const partner = talkingTo && canTalkTo(session.world, talkingTo) ? session.world.characters[talkingTo] : undefined;
  const canSend =
    !running &&
    !historyBusy &&
    !moduleBusy &&
    !notStarted &&
    (partner ? draft.trim() !== '' : draft.trim() !== '' || staged.length > 0);
  const hasPrevSnapshot = Boolean(
    session.snapshotTurns?.includes(session.world.turn - 1) ||
      session.snapshots?.some((s) => s.turn === session.world.turn - 1),
  );
  const canUndoOrReroll = !running && !historyBusy && session.world.turn >= 1 && hasPrevSnapshot;
  const canBranch = !running && !historyBusy && session.world.turn >= 1;

  const usage = session.usage;
  const totalTokens = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
  const cachePct =
    usage && usage.inputTokens > 0 ? Math.round((usage.cachedInputTokens / usage.inputTokens) * 100) : 0;
  const activeProvider = settings?.gameMaster.provider ?? 'mock';
  const activeModel =
    activeProvider === 'mock'
      ? ''
      : settings?.gameMaster.model.trim() ||
        settings?.connections[activeProvider]?.model.trim() ||
        CONNECTION_DEFAULTS[activeProvider].model;
  const contextLimit = resolveModelContextWindow(activeProvider, activeModel);
  const contextLimitLabel = formatContextWindow(contextLimit);
  const lastTurnInput = usage?.lastTurn?.inputTokens ?? 0;
  const contextPct =
    lastTurnInput > 0 && contextLimit > 0
      ? Math.min(100, Math.round((lastTurnInput / contextLimit) * 1000) / 10)
      : 0;

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
                  disabled={running || historyBusy}
                  onClick={() => {
                    const promptText =
                      session.language === 'zh'
                        ? '依卿之见，眼下当如何定夺？'
                        : 'What course of action do you advise right now?';
                    sendTalk(promptText);
                  }}
                >
                  <Icon name="sparkle" size={13} />
                  <span>{t('story.directives.askCounsel')}</span>
                </button>
                {(() => {
                  const lastLine = [...session.messages]
                    .reverse()
                    .find((m): m is DialogueMessage => m.kind === 'dialogue' && m.characterId === partner.id);
                  if (!lastLine) return null;
                  return (
                    <button
                      type="button"
                      className="talk-bar__stop talk-bar__stop--accent"
                      disabled={running || historyBusy}
                      onClick={() => {
                        const modId = session.modules[0] ?? 'dice';
                        stageDirective({
                          moduleId: modId,
                          op: 'advisor_note',
                          params: { characterId: partner.id },
                          label: t('story.directives.advisorLabel', { name: partner.name }),
                          aiNote: `${partner.name}: ${lastLine.text.slice(0, 220)}`,
                        });
                        stopTalking();
                        textareaRef.current?.focus();
                      }}
                    >
                      <Icon name="queue" size={13} />
                      <span>{t('story.directives.adoptCounsel')}</span>
                    </button>
                  );
                })()}
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

        {staged.length > 0 && (
          <div className="directive-tray" role="region" aria-label={t('story.directives.trayTitle', { count: staged.length })}>
            <div className="directive-tray__head">
              <span className="directive-tray__title">
                <Icon name="queue" size={13} />
                <span>{t('story.directives.trayTitle', { count: staged.length })}</span>
              </span>
              <div className="directive-tray__actions">
                {partner && (
                  <button
                    type="button"
                    className="directive-tray__clear directive-tray__clear--accent"
                    onClick={() => {
                      stopTalking();
                      textareaRef.current?.focus();
                    }}
                  >
                    {t('story.directives.switchToAct', { count: staged.length })}
                  </button>
                )}
                <button
                  type="button"
                  className="directive-tray__clear"
                  disabled={running}
                  onClick={clearDirectives}
                >
                  {t('story.directives.clear')}
                </button>
              </div>
            </div>
            <ul className="directive-tray__list">
              {staged.map((dir, idx) => {
                const glyph = (MODULE_GLYPH as Record<string, string | undefined>)[dir.moduleId] ?? '✦';
                const label = dir.label || dir.op;
                const key = dir.id ?? `${idx}:${dir.moduleId}:${dir.op}`;
                return (
                  <li key={key} className="directive-chip">
                    <span className="directive-chip__glyph" aria-hidden="true">
                      {glyph}
                    </span>
                    <span className="directive-chip__label" lang={storyLang}>
                      {label}
                    </span>
                    {dir.id && (
                      <button
                        type="button"
                        className="directive-chip__remove"
                        aria-label={t('story.directives.removeAria', { label })}
                        disabled={running}
                        onClick={() => removeDirective(dir.id!)}
                      >
                        <Icon name="close" size={11} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <form
          className={`composer${running ? ' is-running' : ''}${partner ? ' is-talking' : ''}${!partner && staged.length > 0 ? ' has-directives' : ''}`}
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
              partner
                ? t('story.composerTalkPlaceholder', { name: partner.name })
                : staged.length > 0
                  ? t('story.directives.placeholderReady', { count: staged.length })
                  : t('story.composerPlaceholder')
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
                  lastInput: formatNumber(lastTurnInput, uiTag),
                  contextLimit: contextLimitLabel,
                  contextPct,
                })}
              >
                {lastTurnInput > 0
                  ? cachePct > 0
                    ? t('story.usageContextWithCache', {
                        used: compactTokens(lastTurnInput, uiTag),
                        limit: contextLimitLabel,
                        cache: cachePct,
                      })
                    : t('story.usageContext', {
                        used: compactTokens(lastTurnInput, uiTag),
                        limit: contextLimitLabel,
                      })
                  : cachePct > 0
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
