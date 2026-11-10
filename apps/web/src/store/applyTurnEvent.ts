import type { Message, Session, TurnEvent } from '@roleplay/shared';

/** Prefix of ids the client invents for its optimistic copy of the player's action. */
export const LOCAL_ID_PREFIX = 'local:';

export function isLocalMessage(message: Message): boolean {
  return message.id.startsWith(LOCAL_ID_PREFIX);
}

export interface LiveTurn {
  session: Session;
  /** Ids of narration messages that are still streaming. */
  streaming: readonly string[];
}

const without = (ids: readonly string[], id: string) => (ids.includes(id) ? ids.filter((x) => x !== id) : ids);

/**
 * Applies one streamed event to the open session. Streaming narration lives in
 * `session.messages` as a provisional message, so it keeps its place relative
 * to event messages that arrive while it is being written.
 * `done` and `error` are handled by the caller.
 */
export function applyTurnEvent(state: LiveTurn, event: TurnEvent): LiveTurn {
  const { session, streaming } = state;

  switch (event.type) {
    case 'narration_delta': {
      if (event.text === '') return state;
      const index = session.messages.findIndex((m) => m.id === event.id);
      const messages = session.messages.slice();
      if (index === -1) {
        messages.push({
          kind: 'narration',
          id: event.id,
          text: event.text,
          turn: session.world.turn + 1,
          createdAt: new Date().toISOString(),
        });
      } else {
        const existing = messages[index];
        if (existing?.kind !== 'narration') return state;
        messages[index] = { ...existing, text: existing.text + event.text };
      }
      return {
        session: { ...session, messages },
        streaming: streaming.includes(event.id) ? streaming : [...streaming, event.id],
      };
    }

    // A message whose id is already in the log replaces it in place: this finalizes
    // streamed narration and settles a pending illustration (ready / failed).
    case 'message': {
      const incoming = event.message;
      let index = session.messages.findIndex((m) => m.id === incoming.id);
      // The server's copy of the player's action replaces the optimistic one.
      if (index === -1 && incoming.kind === 'player') {
        index = session.messages.findIndex((m) => m.kind === 'player' && isLocalMessage(m));
      }
      const messages = session.messages.slice();
      if (index === -1) messages.push(incoming);
      else messages[index] = incoming;
      return { session: { ...session, messages }, streaming: without(streaming, incoming.id) };
    }

    case 'narration_discard':
      return {
        session: { ...session, messages: session.messages.filter((m) => m.id !== event.id) },
        streaming: without(streaming, event.id),
      };

    case 'world':
      return { session: { ...session, world: event.world }, streaming };

    default:
      return state;
  }
}
