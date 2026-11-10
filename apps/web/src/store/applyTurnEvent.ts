import type { Message, Session, TurnEvent } from '@roleplay/shared';

/** Prefix of ids the client invents for its optimistic copy of the player's action. */
export const LOCAL_ID_PREFIX = 'local:';

export function isLocalMessage(message: Message): boolean {
  return message.id.startsWith(LOCAL_ID_PREFIX);
}

export interface LiveTurn {
  session: Session;
  /** Ids of narration and dialogue messages that are still being written. */
  streaming: readonly string[];
}

const withId = (ids: readonly string[], id: string) => (ids.includes(id) ? ids : [...ids, id]);
const without = (ids: readonly string[], id: string) => (ids.includes(id) ? ids.filter((x) => x !== id) : ids);

/**
 * Applies one streamed event to the open session. Streaming text lives in
 * `session.messages` as a provisional message, so it keeps its place relative
 * to event messages that arrive while it is being written.
 * `done` and `error` are handled by the caller.
 */
export function applyTurnEvent(state: LiveTurn, event: TurnEvent): LiveTurn {
  const { session, streaming } = state;

  switch (event.type) {
    // Appends to streaming narration (created on the first delta) or to a
    // character's line that was announced by an empty dialogue `message`.
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
        if (existing?.kind !== 'narration' && existing?.kind !== 'dialogue') return state;
        messages[index] = { ...existing, text: existing.text + event.text };
      }
      return { session: { ...session, messages }, streaming: withId(streaming, event.id) };
    }

    // A message whose id is already in the log replaces it in place: this finalizes
    // streamed narration and dialogue, and settles a pending illustration.
    case 'message': {
      const incoming = event.message;
      let index = session.messages.findIndex((m) => m.id === incoming.id);
      // The server's copy of the player's message replaces the optimistic one.
      if (index === -1 && incoming.kind === 'player') {
        index = session.messages.findIndex((m) => m.kind === 'player' && isLocalMessage(m));
      }
      const messages = session.messages.slice();
      if (index === -1) messages.push(incoming);
      else messages[index] = incoming;
      // A dialogue message with no text yet announces who is about to speak; its words stream next.
      const announced = incoming.kind === 'dialogue' && incoming.text === '';
      return {
        session: { ...session, messages },
        streaming: announced ? withId(streaming, incoming.id) : without(streaming, incoming.id),
      };
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
