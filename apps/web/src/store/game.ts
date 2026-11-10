import type {
  CreateSessionRequest,
  ModuleId,
  PlayerMessage,
  Session,
  SessionSummary,
  TurnRequest,
} from '@roleplay/shared';
import { create } from 'zustand';
import { api } from '../api/client';
import { RequestError, toUiError, type UiError } from '../api/errors';
import { streamTurn } from '../api/turns';
import { storage } from '../lib/storage';
import { canTalkTo } from '../lib/world';
import { applyTurnEvent, isLocalMessage, LOCAL_ID_PREFIX } from './applyTurnEvent';

const SESSION_KEY = 'rp.session';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface RunningTurn {
  sessionId: string;
  request: TurnRequest;
  controller: AbortController;
  /** world.turn when the turn began; tells afterwards whether the server kept the action. */
  startTurn: number;
  /** Narration and dialogue ids still streaming. */
  streaming: readonly string[];
}

export interface TurnFailure {
  error: UiError;
  request: TurnRequest;
  /** False when the turn stands as far as it got: sending it again would play it twice. */
  retryable: boolean;
}

interface GameState {
  sessions: SessionSummary[];
  sessionsStatus: LoadStatus;
  current: Session | null;
  /** Id of the session being fetched for display. */
  opening: string | null;
  openError: { id: string; error: UiError } | null;
  turn: RunningTurn | null;
  failure: TurnFailure | null;
  /** Unsent composer text per session. */
  drafts: Record<string, string>;
  /**
   * The character the player is speaking to in the open session, or null to act.
   * Survives across turns; cleared when they leave the scene or the session changes.
   */
  talkingTo: string | null;

  init: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  openSession: (id: string, options?: { restoring?: boolean }) => Promise<void>;
  createGame: (request: CreateSessionRequest) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  /** Changes the modules of the open story, from its next turn. Throws when the server refuses. */
  setModules: (modules: ModuleId[]) => Promise<void>;
  sendAction: (text: string) => void;
  /** Says `text` to the character in `talkingTo`. */
  sendTalk: (text: string) => void;
  startTalking: (characterId: string) => void;
  stopTalking: () => void;
  beginStory: () => void;
  retry: () => void;
  stop: () => void;
  dismissFailure: () => void;
  setDraft: (text: string) => void;
}

let initialized = false;
let localSeq = 0;

/** The client's copy of what the player said or did, shown until the server echoes its own. */
function optimisticPlayerMessage(request: TurnRequest, turn: number): PlayerMessage | null {
  if (request.kind === 'start') return null;
  localSeq += 1;
  const message: PlayerMessage = {
    kind: 'player',
    id: `${LOCAL_ID_PREFIX}${localSeq}`,
    text: request.text,
    turn,
    createdAt: new Date().toISOString(),
  };
  if (request.kind === 'talk') message.to = request.characterId;
  return message;
}

/** Keeps the conversation partner only while they can still be spoken to. */
function stillTalkingTo(characterId: string | null, session: Session): string | null {
  return characterId !== null && canTalkTo(session.world, characterId) ? characterId : null;
}

function toSummary(session: Session): SessionSummary {
  return {
    id: session.id,
    title: session.world.title,
    premise: session.seed.premise || session.world.premise,
    language: session.language,
    turn: session.world.turn,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function byRecent(a: SessionSummary, b: SessionSummary): number {
  return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
}

/** Drops what only this client added during a turn: the optimistic action and unfinished narration. */
function withoutProvisional(session: Session, streaming: readonly string[]): Session {
  return {
    ...session,
    messages: session.messages.filter((m) => !isLocalMessage(m) && !streaming.includes(m.id)),
  };
}

export const useGame = create<GameState>()((set, get) => {
  /** Aborts a running turn without touching the session; used when leaving it. */
  function abandonTurn(): void {
    const turn = get().turn;
    if (!turn) return;
    turn.controller.abort();
    set({ turn: null });
  }

  async function reload(sessionId: string): Promise<Session | null> {
    try {
      const session = await api.getSession(sessionId);
      const state = get();
      // Another session or a new turn may have started while this was in flight.
      if (state.current?.id === sessionId && state.turn === null) {
        set({ current: session, talkingTo: stillTalkingTo(state.talkingTo, session) });
      }
      return session;
    } catch {
      return null;
    }
  }

  /** Puts words the server did not keep back into the composer, unless the player has typed something new. */
  function restoreDraft(turn: RunningTurn, reloaded: Session | null): void {
    if (turn.request.kind === 'start') return;
    const text = turn.request.text;
    const kept =
      reloaded?.messages.some((m) => m.kind === 'player' && m.turn > turn.startTurn && m.text === text) ?? false;
    if (kept) return;
    const drafts = get().drafts;
    if ((drafts[turn.sessionId] ?? '').trim() !== '') return;
    set({ drafts: { ...drafts, [turn.sessionId]: text } });
  }

  /** After an error or Stop the server may have rolled the turn back, so its copy is the truth. */
  async function settleInterruptedTurn(turn: RunningTurn): Promise<Session | null> {
    const reloaded = await reload(turn.sessionId);
    restoreDraft(turn, reloaded);
    void get().refreshSessions();
    return reloaded;
  }

  async function runTurn(request: TurnRequest): Promise<void> {
    const { current, turn: running } = get();
    if (!current || running) return;

    const controller = new AbortController();
    const turn: RunningTurn = {
      sessionId: current.id,
      request,
      controller,
      startTurn: current.world.turn,
      streaming: [],
    };
    const optimistic = optimisticPlayerMessage(request, current.world.turn + 1);
    const messages = optimistic ? [...current.messages, optimistic] : current.messages;
    set({ current: { ...current, messages }, turn, failure: null });

    const isLive = () => get().turn?.controller === controller;
    const outcome: { error: UiError | null; kept: boolean } = { error: null, kept: false };

    try {
      await streamTurn(turn.sessionId, request, controller.signal, (event) => {
        if (!isLive()) return;
        if (event.type === 'error') {
          outcome.error = event.error;
          outcome.kept = event.kept;
          return;
        }
        if (event.type === 'done') {
          // The modules as the turn left them: after an opening the game master chose for, only the ones it took up.
          const current = get().current;
          if (current && Array.isArray(event.modules)) {
            // The server settles the choice at the end of a story turn, never a conversation.
            const modulesAuto = request.kind === 'talk' ? current.modulesAuto : false;
            set({ current: { ...current, modules: event.modules, modulesAuto } });
          }
          return;
        }
        const state = get();
        if (!state.current || !state.turn) return;
        const next = applyTurnEvent({ session: state.current, streaming: state.turn.streaming }, event);
        set({
          current: next.session,
          turn: { ...state.turn, streaming: next.streaming },
          talkingTo: stillTalkingTo(state.talkingTo, next.session),
        });
      });
    } catch (err) {
      // Stop and session switches abort on purpose and clean up themselves.
      if (controller.signal.aborted) return;
      outcome.error = toUiError(err);
    }
    if (!isLive()) return;

    const state = get();
    const finished = state.turn ?? turn;
    if (outcome.error) {
      const failure: TurnFailure = { error: outcome.error, request, retryable: !outcome.kept };
      set({
        turn: null,
        failure,
        current: state.current ? withoutProvisional(state.current, finished.streaming) : null,
      });
      const reloaded = await settleInterruptedTurn(finished);
      // When the connection broke the server never said what became of the turn;
      // its copy of the session does. A turn that stands must not be offered again.
      if (reloaded && reloaded.world.turn > finished.startTurn && get().failure === failure) {
        set({ failure: { ...failure, retryable: false } });
      }
      return;
    }

    set({ turn: null });
    // The server normally echoes the action as a `message`; if it did not, fetch its copy.
    if (state.current?.messages.some(isLocalMessage)) void reload(turn.sessionId);
    void get().refreshSessions();
  }

  return {
    sessions: [],
    sessionsStatus: 'idle',
    current: null,
    opening: null,
    openError: null,
    turn: null,
    failure: null,
    drafts: {},
    talkingTo: null,

    init: async () => {
      if (initialized) return;
      initialized = true;
      void get().refreshSessions();
      const saved = storage.get(SESSION_KEY);
      if (saved) await get().openSession(saved, { restoring: true });
    },

    refreshSessions: async () => {
      if (get().sessionsStatus === 'idle') set({ sessionsStatus: 'loading' });
      try {
        const sessions = await api.listSessions();
        set({ sessions: [...sessions].sort(byRecent), sessionsStatus: 'ready' });
      } catch {
        // Keep showing a list we already have; only an initial failure is worth a message.
        if (get().sessionsStatus !== 'ready') set({ sessionsStatus: 'error' });
      }
    },

    openSession: async (id, options) => {
      const state = get();
      if ((state.current?.id === id && !state.openError) || state.opening === id) return;
      abandonTurn();
      set({ opening: id, openError: null, current: null, failure: null, talkingTo: null });
      try {
        const session = await api.getSession(id);
        if (get().opening !== id) return;
        set({ current: session, opening: null });
        storage.set(SESSION_KEY, id);
      } catch (err) {
        if (get().opening !== id) return;
        const error = toUiError(err);
        if (error.code === 'not_found') {
          storage.remove(SESSION_KEY);
          void get().refreshSessions();
        }
        // A saved id that no longer exists is not worth an error on startup.
        const quiet = options?.restoring === true && error.code === 'not_found';
        set({ opening: null, openError: quiet ? null : { id, error } });
      }
    },

    createGame: async (request) => {
      const session = await api.createSession(request);
      abandonTurn();
      set((s) => ({
        current: session,
        opening: null,
        openError: null,
        failure: null,
        talkingTo: null,
        sessions: [toSummary(session), ...s.sessions.filter((x) => x.id !== session.id)],
      }));
      storage.set(SESSION_KEY, session.id);
      void runTurn({ kind: 'start' });
    },

    deleteSession: async (id) => {
      try {
        await api.deleteSession(id);
      } catch (err) {
        if (!(err instanceof RequestError && err.info.code === 'not_found')) throw err;
      }
      const state = get();
      if (state.current?.id === id || state.opening === id || state.openError?.id === id) {
        abandonTurn();
        set({ current: null, opening: null, openError: null, failure: null, talkingTo: null });
        storage.remove(SESSION_KEY);
      }
      set((s) => {
        const drafts = { ...s.drafts };
        delete drafts[id];
        return { sessions: s.sessions.filter((x) => x.id !== id), drafts };
      });
    },

    setModules: async (modules) => {
      const { current, turn } = get();
      if (!current) return;
      if (turn) throw new RequestError({ code: 'turn_in_progress', message: 'A turn is being generated.' });
      const updated = await api.updateSession(current.id, { modules });
      // Only the module fields: the log and world in hand are as new as the server's.
      const latest = get().current;
      if (latest?.id !== updated.id) return;
      set({
        current: { ...latest, modules: updated.modules, modulesAuto: updated.modulesAuto, updatedAt: updated.updatedAt },
      });
    },

    sendAction: (text) => {
      const trimmed = text.trim();
      if (trimmed) void runTurn({ kind: 'action', text: trimmed });
    },

    sendTalk: (text) => {
      const { current, talkingTo } = get();
      const trimmed = text.trim();
      if (!trimmed || !current || !talkingTo || !canTalkTo(current.world, talkingTo)) return;
      void runTurn({ kind: 'talk', characterId: talkingTo, text: trimmed });
    },

    startTalking: (characterId) => {
      const current = get().current;
      if (current && canTalkTo(current.world, characterId)) set({ talkingTo: characterId });
    },

    stopTalking: () => set({ talkingTo: null }),

    beginStory: () => {
      void runTurn({ kind: 'start' });
    },

    retry: () => {
      const { failure, current, drafts } = get();
      if (!failure?.retryable || !current) return;
      // The failed text was put back into the composer; retrying sends it, so clear it there.
      if (failure.request.kind !== 'start' && (drafts[current.id] ?? '').trim() === failure.request.text) {
        set({ drafts: { ...drafts, [current.id]: '' } });
      }
      void runTurn(failure.request);
    },

    stop: () => {
      const { turn, current } = get();
      if (!turn) return;
      turn.controller.abort();
      set({ turn: null, current: current ? withoutProvisional(current, turn.streaming) : null });
      void settleInterruptedTurn(turn);
    },

    dismissFailure: () => set({ failure: null }),

    setDraft: (text) => {
      const id = get().current?.id;
      if (!id) return;
      set((s) => ({ drafts: { ...s.drafts, [id]: text } }));
    },
  };
});
