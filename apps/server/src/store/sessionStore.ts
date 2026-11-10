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
} from '@roleplay/shared';
import { normalizeModules } from '../engine/modules';
import { isNotFound, readJson, writeJson } from './jsonFile';

// Ids become file names, so anything outside this shape is rejected before touching disk.
const ID_PATTERN = /^[A-Za-z0-9_-]{6,40}$/;

export function isValidSessionId(id: string): boolean {
  return ID_PATTERN.test(id);
}

/**
 * Brings a save written by an earlier version up to the current shape, so the
 * rest of the code never meets a missing field. Each line here is a field that
 * was added after saves already existed.
 */
function upgrade(session: Session): Session {
  const saved = session as Partial<Session> & Session;
  // Dice were the one instrument every story had before modules existed.
  saved.modules ??= ['dice'];
  saved.modulesAuto ??= false;
  const world = session.world as Partial<Session['world']> & Session['world'];
  world.artStyle ??= '';
  world.modules ??= {};
  for (const character of Object.values(world.characters)) {
    const mind = character as Partial<typeof character>;
    mind.voice ??= '';
    mind.goals ??= '';
    mind.secrets ??= '';
    mind.memories ??= [];
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

/** One JSON file per session under `<dataDir>/sessions`. */
export class SessionStore {
  private readonly dir: string;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'sessions');
  }

  private file(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  async list(): Promise<SessionSummary[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (err) {
      if (isNotFound(err)) return [];
      throw err;
    }
    const ids = names.filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -'.json'.length));
    const sessions = await Promise.all(ids.map((id) => this.get(id)));
    return sessions
      .filter((s): s is Session => s !== null)
      .map(summarize)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<Session | null> {
    if (!isValidSessionId(id)) return null;
    const session = await readJson<Session>(this.file(id));
    return session ? upgrade(session) : null;
  }

  /**
   * Starts a story. `subscribed` is what the player subscribes to: a story can
   * only be given modules from among those.
   */
  async create(request: CreateSessionRequest, subscribed: readonly ModuleId[] = MODULE_IDS): Promise<Session> {
    const available = normalizeModules(subscribed);
    const now = new Date().toISOString();
    const session: Session = {
      id: randomBytes(9).toString('base64url'),
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
    };
    await writeJson(this.file(session.id), session);
    return session;
  }

  async save(session: Session): Promise<void> {
    session.updatedAt = new Date().toISOString();
    await writeJson(this.file(session.id), session);
  }

  async delete(id: string): Promise<boolean> {
    if (!isValidSessionId(id)) return false;
    try {
      await unlink(this.file(id));
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }
}
