import type { EventMessage, Message, Session } from '@roleplay/shared';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { languageTag } from '../../i18n';
import { isLocalMessage } from '../../store/applyTurnEvent';
import { useGame } from '../../store/game';
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

  const running = turn !== null && turn.sessionId === session.id;
  const streaming = running ? turn.streaming : NO_IDS;
  const thinking = running && streaming.length === 0;
  // The server holds `done` until pictures settle; say so when that is all we are waiting for.
  const painting = thinking && session.messages.some((m) => m.kind === 'image' && m.status === 'pending');
  const notStarted = session.world.turn === 0 && session.messages.length === 0 && !running && !failure;
  const storyLang = languageTag(session.language);
  const playerName = session.world.playerId ? session.world.characters[session.world.playerId]?.name : undefined;
  const blocks = useMemo(() => groupMessages(session.messages), [session.messages]);

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
          if (block.kind === 'events') return <EventRow key={block.key} events={block.events} world={session.world} />;
          const message = block.message;
          if (message.kind === 'player') {
            return (
              <PlayerAction
                key={message.id}
                text={message.text}
                speaker={playerName}
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
          if (message.kind === 'image') return <Illustration key={message.id} message={message} lang={storyLang} />;
          return null;
        })}

        {thinking && (
          <p className="thinking">
            <span className="thinking__dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            {painting ? t('story.painting') : t('story.thinking')}
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
