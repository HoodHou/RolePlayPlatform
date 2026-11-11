import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SessionBackupImage } from '@roleplay/shared';
import { extensionOf, type ImageExtension, type Painting } from '../images/types';
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

  /** Lists valid stored image filenames for a session. */
  async listFiles(sessionId: string): Promise<string[]> {
    if (!isValidSessionId(sessionId)) return [];
    try {
      const names = await readdir(path.join(this.dir, sessionId));
      return names.filter((name) => FILE_PATTERN.test(name));
    } catch (err) {
      if (isNotFound(err)) return [];
      throw err;
    }
  }

  /** Copies all stored images from one session into another, keeping filenames identical. */
  async copySession(fromSessionId: string, toSessionId: string): Promise<void> {
    if (!isValidSessionId(fromSessionId) || !isValidSessionId(toSessionId)) return;
    const files = await this.listFiles(fromSessionId);
    if (files.length === 0) return;
    const srcDir = path.join(this.dir, fromSessionId);
    const dstDir = path.join(this.dir, toSessionId);
    await mkdir(dstDir, { recursive: true });
    await Promise.all(files.map((file) => copyFile(path.join(srcDir, file), path.join(dstDir, file))));
  }

  /** Reads every stored image of a session as base64 for single-file backup export. */
  async exportSession(sessionId: string): Promise<Record<string, SessionBackupImage>> {
    const files = await this.listFiles(sessionId);
    const entries = await Promise.all(
      files.map(async (file) => {
        const read = await this.read(sessionId, file);
        return read ? ([file, { contentType: read.contentType, dataBase64: read.data.toString('base64') }] as const) : null;
      }),
    );
    return Object.fromEntries(entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null));
  }

  /**
   * Restores base64-encoded images into `sessionId` under freshly generated filenames,
   * returning a map from original filename to the new `/api/images/<sessionId>/<file>` URL.
   */
  async importSession(sessionId: string, images: Record<string, SessionBackupImage>): Promise<Map<string, string>> {
    const urlByOldFile = new Map<string, string>();
    for (const [oldFile, entry] of Object.entries(images)) {
      const data = Buffer.from(entry.dataBase64, 'base64');
      if (data.length === 0) continue;
      const isSvg = entry.contentType === 'image/svg+xml' || /\.svg$/i.test(oldFile);
      const extension: ImageExtension = isSvg ? 'svg' : extensionOf(data);
      const newUrl = await this.save(sessionId, { data, extension });
      urlByOldFile.set(oldFile, newUrl);
    }
    return urlByOldFile;
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (!isValidSessionId(sessionId)) return;
    await rm(path.join(this.dir, sessionId), { recursive: true, force: true });
  }
}
