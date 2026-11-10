import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ImageExtension, Painting } from '../images/types';
import { isNotFound } from './jsonFile';
import { isValidSessionId } from './sessionStore';

const CONTENT_TYPES: Record<ImageExtension, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

// Names are generated here, so anything else in a URL is not one of ours.
const FILE_PATTERN = /^[a-f0-9]{16}\.(png|jpg|webp|svg)$/;

/** Pictures on disk under `<dataDir>/images/<sessionId>/`, served at `/api/images/...`. */
export class ImageStore {
  private readonly dir: string;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'images');
  }

  /** Stores a picture and returns the URL path it is served at. */
  async save(sessionId: string, painting: Painting): Promise<string> {
    if (!isValidSessionId(sessionId)) throw new Error(`Invalid session id: ${sessionId}`);
    const file = `${randomBytes(8).toString('hex')}.${painting.extension}`;
    const dir = path.join(this.dir, sessionId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, file), painting.data);
    return `/api/images/${sessionId}/${file}`;
  }

  async read(sessionId: string, file: string): Promise<{ data: Buffer; contentType: string } | null> {
    const match = FILE_PATTERN.exec(file);
    if (!match || !isValidSessionId(sessionId)) return null;
    try {
      const data = await readFile(path.join(this.dir, sessionId, file));
      return { data, contentType: CONTENT_TYPES[match[1] as ImageExtension] };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (!isValidSessionId(sessionId)) return;
    await rm(path.join(this.dir, sessionId), { recursive: true, force: true });
  }
}
