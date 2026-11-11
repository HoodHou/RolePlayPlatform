import {
  ERROR_CODES,
  type CreateSessionRequest,
  type ErrorCode,
  type ModuleDirective,
  type ModuleId,
  type PlayerMessage,
  type Session,
  type SessionBackup,
  type SessionSummary,
  type TurnRequest,
} from '@roleplay/shared';
import { create } from 'zustand';
import { api } from '../api/client';
import { RequestError, toUiError, type UiError } from '../api/errors';
import { streamTurn } from '../api/turns';
import { storage } from '../lib/storage';
import { canTalkTo } from '../lib/world';
import { applyTurnEvent, isLocalMessage, LOCAL_ID_PREFIX } from './applyTurnEvent';
import { useLibrary } from './library';

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
  /** True while undo, reroll, branch or import is in flight. */
  historyBusy: boolean;
  /** Queued module directives per session, settled together on the next `action` turn. */
  stagedDirectives: Record<string, ModuleDirective[]>;
  /** True while a 0-token instant module operation is in flight. */
  moduleBusy: boolean;
  /** Feedback banner shown in the world panel after an instant operation or staging action. */
  lastModuleNotice: { text: string; isError?: boolean } | null;
  /** Image message ids currently being repainted on user request. */
  retryingImages: Record<string, boolean>;
  /** Character portraits currently being painted (`${sessionId}:${characterId}`). */
  paintingCharacters: Record<string, boolean>;
  /** Last portrait painting error per character (`${sessionId}:${characterId}`). */
  portraitErrors: Record<string, UiError>;

  init: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  openSession: (id: string, options?: { restoring?: boolean }) => Promise<void>;
  createGame: (request: CreateSessionRequest) => Promise<void>;
  importSave: (backup: unknown) => Promise<Session>;
  exportSave: () => Promise<SessionBackup | null>;
  deleteSession: (id: string) => Promise<void>;
  /** Changes the modules of the open story, from its next turn. Throws when the server refuses. */
  setModules: (modules: ModuleId[]) => Promise<void>;
  sendAction: (text: string) => void;
  /** Executes a module operation immediately on the server at 0 LLM tokens. */
  executeDirective: (directive: ModuleDirective) => Promise<boolean>;
  /** Dispatches a structured panel directive (merged with any queued directives) as an AI-adjudicated turn. */
  dispatchDirective: (directive: ModuleDirective) => void;
  /** Adds (or toggles off) a module operation in the next turn's staged directive queue. */
  stageDirective: (directive: ModuleDirective) => void;
  removeDirective: (directiveId: string) => void;
  clearDirectives: () => void;
  dismissModuleNotice: () => void;
  /** Says `text` to the character in `talkingTo`. */
  sendTalk: (text: string) => void;
  startTalking: (characterId: string) => void;
  stopTalking: () => void;
  beginStory: () => void;
  retry: () => void;
  stop: () => void;
  dismissFailure: () => void;
  setDraft: (text: string) => void;
  /** Rolls the open session back by one turn, restoring the player's action to the composer if empty. */
  undoTurn: () => Promise<void>;
  /** Rolls the open session back by one turn and immediately replays the last turn request. */
  rerollTurn: () => Promise<void>;
  /** Clones the open session (optionally up to `upToTurn`) into a new parallel save and opens it. */
  forkSession: (upToTurn?: number) => Promise<void>;
  /** Repaints a failed or existing illustration in place. */
  retryImage: (messageId: string) => Promise<void>;
  /** Generates or repaints an NPC's portrait on demand. */
  paintCharacterPortrait: (characterId: string, prompt?: string) => Promise<void>;
  dismissPortraitError: (characterId: string) => void;
  /** Quietly refreshes the open session while background illustrations are still painting. */
  pollCurrentSession: () => Promise<void>;
}

export function portraitKey(sessionId: string, characterId: string): string {
  return `${sessionId}:${characterId}`;
}

export function sameDirective(a: ModuleDirective, b: ModuleDirective): boolean {
  return a.moduleId === b.moduleId && a.op === b.op && JSON.stringify(a.params) === JSON.stringify(b.params);
}

let initialized = false;
let localSeq = 0;

/** The client's copy of what the player said or did, shown until the server echoes its own. */
function optimisticPlayerMessage(request: TurnRequest, turn: number, language = 'en'): PlayerMessage | null {
  if (request.kind === 'start') return null;
  localSeq += 1;
  let text = request.text;
  if (request.kind === 'action' && request.directives && request.directives.length > 0) {
    const zh = language.toLowerCase().startsWith('zh');
    const header =
      (zh ? '【部署】' : '[Directive] ') +
      request.directives.map((d) => d.label || d.op).join(zh ? '；' : '; ');
    text = text.trim() ? `${header}\n${text.trim()}` : header;
  }
  const message: PlayerMessage = {
    kind: 'player',
    id: `${LOCAL_ID_PREFIX}${localSeq}`,
    text,
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

  /** Puts words and staged directives the server did not keep back into the composer. */
  function restoreDraft(turn: RunningTurn, reloaded: Session | null): void {
    if (turn.request.kind === 'start') return;
    const text = turn.request.text;
    const kept =
      (reloaded ? reloaded.world.turn > turn.startTurn : false) ||
      (reloaded?.messages.some((m) => m.kind === 'player' && m.turn > turn.startTurn && m.text === text) ?? false);
    if (kept) return;
    const state = get();
    const nextDrafts =
      text && (state.drafts[turn.sessionId] ?? '').trim() === ''
        ? { ...state.drafts, [turn.sessionId]: text }
        : state.drafts;
    const prevDirectives = state.stagedDirectives[turn.sessionId] ?? [];
    const nextDirectives =
      turn.request.kind === 'action' && turn.request.directives?.length && prevDirectives.length === 0
        ? { ...state.stagedDirectives, [turn.sessionId]: turn.request.directives }
        : state.stagedDirectives;
    if (nextDrafts !== state.drafts || nextDirectives !== state.stagedDirectives) {
      set({ drafts: nextDrafts, stagedDirectives: nextDirectives });
    }
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
    const optimistic = optimisticPlayerMessage(request, current.world.turn + 1, current.language);
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
          // The modules and usage as the turn left them: after an opening the game master chose for, only the ones it took up.
          const current = get().current;
          if (current) {
            const modules = Array.isArray(event.modules) ? event.modules : current.modules;
            // The server settles the choice at the end of a story turn, never a conversation.
            const modulesAuto = request.kind === 'talk' ? current.modulesAuto : false;
            const prevUsage = current.usage ?? { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
            const usage = event.usage
              ? {
                  inputTokens: prevUsage.inputTokens + event.usage.inputTokens,
                  outputTokens: prevUsage.outputTokens + event.usage.outputTokens,
                  cachedInputTokens: prevUsage.cachedInputTokens + event.usage.cachedInputTokens,
                  lastTurn: event.usage,
                }
              : current.usage;
            set({ current: { ...current, modules, modulesAuto, usage } });
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
    // Fetch the server's saved copy so `snapshots` and `usage` stay immediately in sync.
    void reload(turn.sessionId);
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
    historyBusy: false,
    stagedDirectives: {},
    moduleBusy: false,
    lastModuleNotice: null,
    retryingImages: {},
    paintingCharacters: {},
    portraitErrors: {},

    init: async () => {
      if (initialized) return;
      initialized = true;
      void useLibrary.getState().load();
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
        const stagedDirectives = { ...s.stagedDirectives };
        delete stagedDirectives[id];
        return { sessions: s.sessions.filter((x) => x.id !== id), drafts, stagedDirectives };
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
      const { current, stagedDirectives } = get();
      if (!current) return;
      const staged = stagedDirectives[current.id] ?? [];
      const trimmed = text.trim();
      if (!trimmed && staged.length === 0) return;
      if (staged.length > 0) {
        set((s) => ({
          stagedDirectives: { ...s.stagedDirectives, [current.id]: [] },
          lastModuleNotice: null,
        }));
      }
      void runTurn({
        kind: 'action',
        text: trimmed,
        ...(staged.length > 0 ? { directives: staged } : {}),
      });
    },

    executeDirective: async (directive) => {
      const { current, turn, historyBusy, moduleBusy } = get();
      if (!current || turn || historyBusy || moduleBusy || current.world.turn < 1) return false;
      const sessionId = current.id;
      set({ moduleBusy: true, lastModuleNotice: null });
      try {
        const res = await api.executeModuleAction(sessionId, directive);
        set((s) => {
          if (s.current?.id !== sessionId) return { lastModuleNotice: { text: res.summary } };
          const updated: Session = {
            ...s.current,
            world: res.world,
            messages: [...s.current.messages, ...res.messages],
            snapshotTurns: res.snapshotTurns,
            updatedAt: new Date().toISOString(),
          };
          return {
            current: updated,
            talkingTo: stillTalkingTo(s.talkingTo, updated),
            sessions: [toSummary(updated), ...s.sessions.filter((x) => x.id !== updated.id)].sort(byRecent),
            lastModuleNotice: { text: res.summary },
          };
        });
        return true;
      } catch (err) {
        const uiErr = toUiError(err);
        set({ lastModuleNotice: { text: uiErr.message, isError: true } });
        return false;
      } finally {
        set({ moduleBusy: false });
      }
    },

    dispatchDirective: (directive) => {
      const { current, turn, historyBusy, moduleBusy, stagedDirectives, drafts } = get();
      if (!current || turn || historyBusy || moduleBusy || current.world.turn < 1) return;
      const staged = stagedDirectives[current.id] ?? [];
      const id = directive.id ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const entry: ModuleDirective = { ...directive, id };
      const combined = staged.some((d) => sameDirective(d, entry)) ? [...staged] : [...staged, entry];
      const draftText = (drafts[current.id] ?? '').trim();
      set((s) => ({
        stagedDirectives: { ...s.stagedDirectives, [current.id]: [] },
        drafts: draftText ? { ...s.drafts, [current.id]: '' } : s.drafts,
        talkingTo: null,
        lastModuleNotice: null,
      }));
      void runTurn({
        kind: 'action',
        text: draftText,
        directives: combined,
      });
    },

    stageDirective: (directive) => {
      const current = get().current;
      if (!current || current.world.turn < 1) return;
      const existing = get().stagedDirectives[current.id] ?? [];
      const match = existing.find((d) => sameDirective(d, directive));
      if (match) {
        set((s) => ({
          stagedDirectives: {
            ...s.stagedDirectives,
            [current.id]: existing.filter((d) => d.id !== match.id),
          },
          lastModuleNotice: null,
        }));
        return;
      }
      const id = directive.id ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const entry: ModuleDirective = { ...directive, id };
      set((s) => ({
        stagedDirectives: {
          ...s.stagedDirectives,
          [current.id]: [...(s.stagedDirectives[current.id] ?? []), entry],
        },
        lastModuleNotice: { text: directive.label ?? directive.op },
      }));
    },

    removeDirective: (directiveId) => {
      const current = get().current;
      if (!current) return;
      set((s) => ({
        stagedDirectives: {
          ...s.stagedDirectives,
          [current.id]: (s.stagedDirectives[current.id] ?? []).filter((d) => d.id !== directiveId),
        },
      }));
    },

    clearDirectives: () => {
      const current = get().current;
      if (!current) return;
      set((s) => ({
        stagedDirectives: { ...s.stagedDirectives, [current.id]: [] },
      }));
    },

    dismissModuleNotice: () => set({ lastModuleNotice: null }),

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

    importSave: async (backup) => {
      set({ historyBusy: true });
      try {
        const imported = await api.importSession(backup);
        abandonTurn();
        set((s) => ({
          current: imported,
          opening: null,
          openError: null,
          failure: null,
          talkingTo: null,
          sessions: [toSummary(imported), ...s.sessions.filter((x) => x.id !== imported.id)].sort(byRecent),
        }));
        storage.set(SESSION_KEY, imported.id);
        return imported;
      } finally {
        set({ historyBusy: false });
      }
    },

    exportSave: async () => {
      const current = get().current;
      if (!current) return null;
      return api.exportSession(current.id);
    },

    undoTurn: async () => {
      const { current, turn, historyBusy, drafts } = get();
      if (!current || turn || historyBusy || current.world.turn < 1) return;
      const lastTurn = current.world.turn;
      const lastPlayer = [...current.messages]
        .reverse()
        .find((m): m is PlayerMessage => m.kind === 'player' && m.turn === lastTurn);
      set({ historyBusy: true, failure: null });
      try {
        const updated = await api.rollbackSession(current.id, lastTurn - 1);
        const state = get();
        if (state.current?.id !== current.id) return;
        const nextDrafts = { ...drafts };
        if (lastPlayer && (nextDrafts[current.id] ?? '').trim() === '') {
          nextDrafts[current.id] = lastPlayer.text;
        }
        set({
          current: updated,
          drafts: nextDrafts,
          talkingTo:
            lastPlayer?.to && canTalkTo(updated.world, lastPlayer.to)
              ? lastPlayer.to
              : stillTalkingTo(state.talkingTo, updated),
          sessions: [toSummary(updated), ...state.sessions.filter((x) => x.id !== updated.id)].sort(byRecent),
        });
      } finally {
        set({ historyBusy: false });
      }
    },

    rerollTurn: async () => {
      const { current, turn, historyBusy } = get();
      if (!current || turn || historyBusy || current.world.turn < 1) return;
      const lastTurn = current.world.turn;
      const lastPlayer = [...current.messages]
        .reverse()
        .find((m): m is PlayerMessage => m.kind === 'player' && m.turn === lastTurn);
      const replay: TurnRequest | null = lastPlayer
        ? lastPlayer.to
          ? { kind: 'talk', characterId: lastPlayer.to, text: lastPlayer.text }
          : { kind: 'action', text: lastPlayer.text }
        : lastTurn === 1
          ? { kind: 'start' }
          : null;
      if (!replay) return;

      set({ historyBusy: true, failure: null });
      let rolledBack = false;
      try {
        const updated = await api.rollbackSession(current.id, lastTurn - 1);
        const state = get();
        if (state.current?.id !== current.id) return;
        set({
          current: updated,
          talkingTo: stillTalkingTo(state.talkingTo, updated),
          sessions: [toSummary(updated), ...state.sessions.filter((x) => x.id !== updated.id)].sort(byRecent),
        });
        rolledBack = true;
      } finally {
        set({ historyBusy: false });
      }
      if (rolledBack) {
        await runTurn(replay);
      }
    },

    forkSession: async (upToTurn) => {
      const { current, historyBusy } = get();
      if (!current || historyBusy) return;
      set({ historyBusy: true });
      try {
        const forked = await api.forkSession(current.id, upToTurn);
        abandonTurn();
        set((s) => ({
          current: forked,
          opening: null,
          openError: null,
          failure: null,
          talkingTo: null,
          sessions: [toSummary(forked), ...s.sessions.filter((x) => x.id !== forked.id)].sort(byRecent),
        }));
        storage.set(SESSION_KEY, forked.id);
      } finally {
        set({ historyBusy: false });
      }
    },

    retryImage: async (messageId) => {
      const { current, retryingImages } = get();
      if (!current || retryingImages[messageId]) return;
      const sessionId = current.id;
      set((s) => ({
        retryingImages: { ...s.retryingImages, [messageId]: true },
        current:
          s.current?.id === sessionId
            ? {
                ...s.current,
                messages: s.current.messages.map((m) =>
                  m.id === messageId && m.kind === 'image' ? { ...m, status: 'pending', error: undefined } : m,
                ),
              }
            : s.current,
      }));
      try {
        const { message, world } = await api.retryImage(sessionId, messageId);
        set((s) => {
          if (s.current?.id !== sessionId) return {};
          return {
            current: {
              ...s.current,
              world: s.turn ? s.current.world : world,
              messages: s.current.messages.map((m) => (m.id === messageId ? message : m)),
            },
          };
        });
      } catch (err) {
        const uiErr = toUiError(err);
        const apiCode: ErrorCode = (ERROR_CODES as readonly string[]).includes(uiErr.code)
          ? (uiErr.code as ErrorCode)
          : 'provider_error';
        set((s) => {
          if (s.current?.id !== sessionId) return {};
          return {
            current: {
              ...s.current,
              messages: s.current.messages.map((m) =>
                m.id === messageId && m.kind === 'image'
                  ? {
                      ...m,
                      status: 'failed' as const,
                      error: { code: apiCode, message: uiErr.message },
                    }
                  : m,
              ),
            },
          };
        });
      } finally {
        set((s) => {
          const next = { ...s.retryingImages };
          delete next[messageId];
          return { retryingImages: next };
        });
      }
    },

    pollCurrentSession: async () => {
      const { current, turn } = get();
      if (!current || turn) return;
      await reload(current.id);
    },

    paintCharacterPortrait: async (characterId, prompt) => {
      const { current, paintingCharacters } = get();
      if (!current) return;
      const sessionId = current.id;
      const key = portraitKey(sessionId, characterId);
      if (paintingCharacters[key]) return;
      set((s) => {
        const nextErrors = { ...s.portraitErrors };
        delete nextErrors[key];
        return {
          paintingCharacters: { ...s.paintingCharacters, [key]: true },
          portraitErrors: nextErrors,
        };
      });
      try {
        const { url, world } = await api.generateCharacterPortrait(sessionId, characterId, prompt);
        set((s) => {
          if (s.current?.id !== sessionId) return {};
          if (s.turn) {
            const existing = s.current.world.characters[characterId];
            if (!existing) return {};
            return {
              current: {
                ...s.current,
                world: {
                  ...s.current.world,
                  characters: {
                    ...s.current.world.characters,
                    [characterId]: { ...existing, imageUrl: url },
                  },
                },
              },
            };
          }
          return { current: { ...s.current, world } };
        });
        if (!get().turn) void reload(sessionId);
      } catch (err) {
        const uiErr = toUiError(err);
        set((s) => ({
          portraitErrors: { ...s.portraitErrors, [key]: uiErr },
        }));
      } finally {
        set((s) => {
          const next = { ...s.paintingCharacters };
          delete next[key];
          return { paintingCharacters: next };
        });
      }
    },

    dismissPortraitError: (characterId) => {
      const sessionId = get().current?.id;
      if (!sessionId) return;
      const key = portraitKey(sessionId, characterId);
      set((s) => {
        if (!s.portraitErrors[key]) return {};
        const next = { ...s.portraitErrors };
        delete next[key];
        return { portraitErrors: next };
      });
    },
  };
});
