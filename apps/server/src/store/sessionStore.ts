import { randomBytes } from 'node:crypto';
import { readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import {
  createEmptyWorld,
  type CreateSessionRequest,
  type Session,
  type SessionSummary,
} from '@roleplay/shared';
import { isNotFound, readJson, writeJson } from './jsonFile';

// Ids become file names, so anything outside this shape is rejected before touching disk.
const ID_PATTERN = /^[A-Za-z0-9_-]{6,40}$/;

export function isValidSessionId(id: string): boolean {
  return ID_PATTERN.test(id);
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
    return readJson<Session>(this.file(id));
  }

  async create(request: CreateSessionRequest): Promise<Session> {
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
