import type { EventMessage, Message, Session } from '@roleplay/shared';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { languageTag } from '../../i18n';
import { canTalkTo } from '../../lib/world';
import { isLocalMessage } from '../../store/applyTurnEvent';
import { useGame } from '../../store/game';
import { DialogueLine } from './DialogueLine';
import { EventRow } from './EventRow';
import { Illustration } from './Illustration';
import { Narration } from './Narration';
import { PlayerAction } from './PlayerAction';
import { TurnErrorBanner } from './TurnErrorBanner';

type Block = { kind: 'message'; message: Message } | { kind: 'events'; key: string; events: EventMessage[] };

/** Consecutive event messages share one row of chips. */
function groupMessages(messages: Message[]): Block[] {
  const blocks: Block[] = [];
  for (const message of messages) {
    const last = blocks[blocks.length - 1];
    if (message.kind !== 'event') blocks.push({ kind: 'message', message });
    else if (last?.kind === 'events') last.events.push(message);
    else blocks.push({ kind: 'events', key: message.id, events: [message] });
  }
  return blocks;
}

const NO_IDS: readonly string[] = [];
/** How close to the bottom (px) still counts as "following along". */
const PIN_THRESHOLD = 80;

export function MessageLog({ session }: { session: Session }) {
  const { t } = useTranslation();
  const turn = useGame((s) => s.turn);
  const failure = useGame((s) => s.failure);
  const beginStory = useGame((s) => s.beginStory);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  const { world } = session;
  const running = turn !== null && turn.sessionId === session.id;
  const streaming = running ? turn.streaming : NO_IDS;
  const thinking = running && streaming.length === 0;
  const notStarted = world.turn === 0 && session.messages.length === 0 && !running && !failure;
  const storyLang = languageTag(session.language);
  const playerName = world.playerId ? world.characters[world.playerId]?.name : undefined;
  const blocks = useMemo(() => groupMessages(session.messages), [session.messages]);

  // Names the dialogue lines recorded, by turn and speaker: the fallback for a "to …" label
  // when the character has since left the world.
  const spokenNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const m of session.messages) if (m.kind === 'dialogue') names.set(`${m.turn}:${m.characterId}`, m.characterName);
    return names;
  }, [session.messages]);

  // Who the indicator says is thinking: the character until they start to answer, then the game master.
  let thinkingLabel: string | null = null;
  if (thinking) {
    const request = turn.request;
    const talkName = request.kind === 'talk' ? world.characters[request.characterId]?.name : undefined;
    const answered =
      request.kind === 'talk' &&
      session.messages.some((m) => m.kind === 'dialogue' && m.characterId === request.characterId && m.turn > turn.startTurn);
    // The server holds `done` until pictures settle; say so when that is all we are waiting for.
    const painting = session.messages.some((m) => m.kind === 'image' && m.status === 'pending');
    if (painting) thinkingLabel = t('story.painting');
    else if (talkName && !answered) thinkingLabel = t('story.characterThinking', { name: talkName });
    else thinkingLabel = t('story.thinking');
  }

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  // Opening a session starts at the latest message.
  useLayoutEffect(() => {
    pinned.current = true;
    scrollToBottom();
  }, [session.id]);

  // Sending an action (or starting the story) brings the reader back to the bottom.
  const wasRunning = useRef(running);
  useLayoutEffect(() => {
    if (running && !wasRunning.current) {
      pinned.current = true;
      scrollToBottom();
    }
    wasRunning.current = running;
  }, [running]);

  // Otherwise follow new content only while the reader is already near the bottom.
  useLayoutEffect(() => {
    if (pinned.current) scrollToBottom();
  }, [session.messages, thinking, failure]);

  // The log also shrinks when the composer grows or suggestions appear.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD;
  };

  return (
    <div className="log" ref={scrollRef} onScroll={onScroll}>
      <div className="log__inner" role="log" aria-label={t('story.logLabel')} aria-busy={running}>
        {blocks.map((block) => {
          if (block.kind === 'events') {
            return <EventRow key={block.key} events={block.events} world={session.world} lang={storyLang} />;
          }
          const message = block.message;
          if (message.kind === 'player') {
            const toName = message.to
              ? (world.characters[message.to]?.name ?? spokenNames.get(`${message.turn}:${message.to}`))
              : undefined;
            return (
              <PlayerAction
                key={message.id}
                text={message.text}
                speaker={playerName}
                toName={toName}
                lang={storyLang}
                pending={isLocalMessage(message)}
              />
            );
          }
          if (message.kind === 'narration') {
            return (
              <Narration key={message.id} text={message.text} streaming={streaming.includes(message.id)} lang={storyLang} />
            );
          }
          if (message.kind === 'dialogue') {
            return (
              <DialogueLine
                key={message.id}
                message={message}
                imageUrl={world.characters[message.characterId]?.imageUrl}
                streaming={streaming.includes(message.id)}
                lang={storyLang}
                canTalk={canTalkTo(world, message.characterId)}
              />
            );
          }
          if (message.kind === 'image') return <Illustration key={message.id} message={message} lang={storyLang} />;
          return null;
        })}

        {thinkingLabel && (
          <p className="thinking">
            <span className="thinking__dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            {thinkingLabel}
          </p>
        )}

        {notStarted && (
          <div className="begin">
            <p className="begin__text">{t('story.notStarted')}</p>
            <button type="button" className="btn btn--primary btn--large" onClick={beginStory}>
              {t('story.begin')}
            </button>
          </div>
        )}

        {failure && <TurnErrorBanner failure={failure} />}
      </div>
    </div>
  );
}
