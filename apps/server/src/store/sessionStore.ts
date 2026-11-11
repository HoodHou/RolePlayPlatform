import { randomBytes } from 'node:crypto';
import { readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import {
  createEmptyWorld,
  MODULE_IDS,
  type CreateSessionRequest,
  type ModuleId,
  type Session,
  type SessionSummary,
  type TokenUsage,
  type TurnSnapshot,
  type WorldState,
} from '@roleplay/shared';
import { normalizeModules } from '../engine/modules';
import { AppError } from '../errors';
import { isNotFound, readJson, writeJson } from './jsonFile';

// Ids become file names, so anything outside this shape is rejected before touching disk.
const ID_PATTERN = /^[A-Za-z0-9_-]{6,40}$/;

/** Maximum engine checkpoints retained per session for undo/reroll/branching. */
export const MAX_SNAPSHOTS = 30;

export function isValidSessionId(id: string): boolean {
  return ID_PATTERN.test(id);
}

export function newSessionId(): string {
  return randomBytes(9).toString('base64url');
}

function upgradeWorld(world: WorldState): WorldState {
  const partial = world as Partial<WorldState> & WorldState;
  partial.artStyle ??= '';
  partial.modules ??= {};
  partial.storySummary ??= '';
  partial.summarizedUpToTurn ??= 0;
  for (const character of Object.values(world.characters)) {
    const mind = character as Partial<typeof character>;
    mind.appearance ??= '';
    mind.voice ??= '';
    mind.goals ??= '';
    mind.secrets ??= '';
    mind.memories ??= [];
  }
  return world;
}

/**
 * Brings a save written by an earlier version up to the current shape, so the
 * rest of the code never meets a missing field. Each line here is a field that
 * was added after saves already existed.
 */
export function upgradeSession(session: Session): Session {
  const saved = session as Partial<Session> & Session;
  // Dice were the one instrument every story had before modules existed.
  saved.modules ??= ['dice'];
  saved.modulesAuto ??= false;
  saved.snapshots ??= [];
  saved.usage ??= { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  upgradeWorld(session.world);
  for (const snap of saved.snapshots) {
    upgradeWorld(snap.world);
  }
  return session;
}

function summarize(session: Session): SessionSummary {
  return {
    id: session.id,
    title: session.world.title,
    premise: session.world.premise || session.seed.premise,
    language: session.language,
    turn: session.world.turn,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

/** Records or replaces the engine checkpoint for `session.world.turn`. */
export function recordSnapshot(session: Session): void {
  const list = (session.snapshots ??= []);
  const entry: TurnSnapshot = {
    turn: session.world.turn,
    world: structuredClone(session.world),
    modules: [...session.modules],
    modulesAuto: session.modulesAuto,
  };
  const existing = list.findIndex((s) => s.turn === entry.turn);
  if (existing >= 0) list[existing] = entry;
  else list.push(entry);
  list.sort((a, b) => a.turn - b.turn);
  if (list.length > MAX_SNAPSHOTS) {
    list.splice(0, list.length - MAX_SNAPSHOTS);
  }
}

/** Accumulates a turn's token usage onto `session.usage`. */
export function recordSessionUsage(session: Session, turnUsage: TokenUsage): void {
  const total = (session.usage ??= { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 });
  total.inputTokens += turnUsage.inputTokens;
  total.outputTokens += turnUsage.outputTokens;
  total.cachedInputTokens += turnUsage.cachedInputTokens;
  total.lastTurn = { ...turnUsage };
}

function rewriteWorldImages(world: WorldState, rewrite: (url: string) => string): void {
  for (const character of Object.values(world.characters)) {
    if (character.imageUrl) character.imageUrl = rewrite(character.imageUrl);
  }
  for (const location of Object.values(world.locations)) {
    if (location.imageUrl) location.imageUrl = rewrite(location.imageUrl);
  }
  for (const item of Object.values(world.items)) {
    if (item.imageUrl) item.imageUrl = rewrite(item.imageUrl);
  }
}

/** Rewrites `/api/images/...` references across world entities, messages and snapshots. */
export function rewriteSessionImages(session: Session, rewrite: (url: string) => string): void {
  rewriteWorldImages(session.world, rewrite);
  for (const message of session.messages) {
    if (message.kind === 'image' && message.url) {
      message.url = rewrite(message.url);
    }
  }
  for (const snap of session.snapshots ?? []) {
    rewriteWorldImages(snap.world, rewrite);
  }
}

/** Restores `session` in place to an earlier turn checkpoint. */
export function rollbackSessionState(session: Session, toTurn: number): Session {
  if (!Number.isInteger(toTurn) || toTurn < 0 || toTurn >= session.world.turn) {
    throw new AppError('bad_request', `Cannot roll back from turn ${session.world.turn} to turn ${toTurn}.`);
  }
  const snap = session.snapshots?.find((s) => s.turn === toTurn);
  if (!snap) {
    throw new AppError('bad_request', `No checkpoint available for turn ${toTurn}.`);
  }
  session.world = structuredClone(snap.world);
  session.modules = [...snap.modules];
  session.modulesAuto = snap.modulesAuto;
  session.messages = session.messages.filter((m) => m.turn <= toTurn);
  session.snapshots = (session.snapshots ?? []).filter((s) => s.turn <= toTurn);
  return session;
}

/** One JSON file per session under `<dataDir>/sessions`, with an in-memory summary index. */
export class SessionStore {
  private readonly dir: string;
  private summaries: Map<string, SessionSummary> | null = null;
  private loadingSummaries: Promise<Map<string, SessionSummary>> | null = null;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'sessions');
  }

  private file(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  private async ensureSummaries(): Promise<Map<string, SessionSummary>> {
    if (this.summaries) return this.summaries;
    if (this.loadingSummaries) return this.loadingSummaries;

    this.loadingSummaries = (async () => {
      let names: string[];
      try {
        names = await readdir(this.dir);
      } catch (err) {
        if (isNotFound(err)) {
          this.summaries = new Map();
          return this.summaries;
        }
        throw err;
      }
      const ids = names.filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -'.json'.length));
      const loaded = await Promise.all(ids.map((id) => this.get(id)));
      const map = new Map<string, SessionSummary>();
      for (const session of loaded) {
        if (session) map.set(session.id, summarize(session));
      }
      this.summaries = map;
      return map;
    })().finally(() => {
      this.loadingSummaries = null;
    });

    return this.loadingSummaries;
  }

  async list(): Promise<SessionSummary[]> {
    const map = await this.ensureSummaries();
    return [...map.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<Session | null> {
    if (!isValidSessionId(id)) return null;
    const session = await readJson<Session>(this.file(id));
    return session ? upgradeSession(session) : null;
  }

  /**
   * Starts a story. `subscribed` is what the player subscribes to: a story can
   * only be given modules from among those.
   */
  async create(request: CreateSessionRequest, subscribed: readonly ModuleId[] = MODULE_IDS): Promise<Session> {
    const available = normalizeModules(subscribed);
    const now = new Date().toISOString();
    const session: Session = {
      id: newSessionId(),
      createdAt: now,
      updatedAt: now,
      language: request.language,
      seed: {
        premise: request.premise?.trim() ?? '',
        playerName: request.playerName?.trim() ?? '',
        playerConcept: request.playerConcept?.trim() ?? '',
      },
      // Left unchosen, every subscribed module is on offer until the game master has opened the story.
      modules: request.modules ? available.filter((id) => request.modules?.includes(id)) : available,
      modulesAuto: request.modules === undefined,
      world: createEmptyWorld(),
      messages: [],
      snapshots: [],
      usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
    };
    recordSnapshot(session);
    await writeJson(this.file(session.id), session);
    this.summaries?.set(session.id, summarize(session));
    return session;
  }

  /** Creates a new independent session branched from `source` (optionally at `upToTurn`). */
  async fork(source: Session, upToTurn?: number, rewriteUrl?: (url: string, newId: string) => string): Promise<Session> {
    const targetTurn = upToTurn ?? source.world.turn;
    if (!Number.isInteger(targetTurn) || targetTurn < 0 || targetTurn > source.world.turn) {
      throw new AppError('bad_request', `Invalid branch turn ${targetTurn}.`);
    }
    const now = new Date().toISOString();
    const cloned: Session = structuredClone(source);
    cloned.id = newSessionId();
    cloned.createdAt = now;
    cloned.updatedAt = now;
    upgradeSession(cloned);
    if (targetTurn < cloned.world.turn) {
      rollbackSessionState(cloned, targetTurn);
    } else if (!cloned.snapshots?.some((s) => s.turn === cloned.world.turn)) {
      recordSnapshot(cloned);
    }
    if (rewriteUrl) rewriteSessionImages(cloned, (url) => rewriteUrl(url, cloned.id));
    await writeJson(this.file(cloned.id), cloned);
    this.summaries?.set(cloned.id, summarize(cloned));
    return cloned;
  }

  /** Imports an exported session under a brand-new id so existing saves are never overwritten. */
  async importWithId(id: string, source: Session, rewriteUrl?: (url: string) => string): Promise<Session> {
    const now = new Date().toISOString();
    const imported = upgradeSession(structuredClone(source));
    imported.id = id;
    imported.updatedAt = now;
    if (!imported.snapshots?.some((s) => s.turn === imported.world.turn)) {
      recordSnapshot(imported);
    }
    if (rewriteUrl) rewriteSessionImages(imported, rewriteUrl);
    await writeJson(this.file(imported.id), imported);
    this.summaries?.set(imported.id, summarize(imported));
    return imported;
  }

  async save(session: Session): Promise<void> {
    session.updatedAt = new Date().toISOString();
    await writeJson(this.file(session.id), session);
    this.summaries?.set(session.id, summarize(session));
  }

  async delete(id: string): Promise<boolean> {
    if (!isValidSessionId(id)) return false;
    try {
      await unlink(this.file(id));
      this.summaries?.delete(id);
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }
}
