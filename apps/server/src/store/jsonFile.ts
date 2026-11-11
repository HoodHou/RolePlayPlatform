import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function isNotFound(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === 'ENOENT';
}

function isTransientRenameError(err: unknown): boolean {
  if (!(err instanceof Error) || !('code' in err)) return false;
  return err.code === 'EPERM' || err.code === 'EACCES' || err.code === 'EBUSY';
}

const RENAME_RETRIES = 4;
const RENAME_BASE_DELAY_MS = 25;

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/** Writes through a unique temp file so concurrent saves never collide and crashes never truncate a save. */
export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(tmp, file);
        return;
      } catch (err) {
        // Windows file indexers or antivirus scanners can briefly hold a handle on the target file.
        if (!isTransientRenameError(err) || attempt >= RENAME_RETRIES) throw err;
        await new Promise((resolve) => setTimeout(resolve, RENAME_BASE_DELAY_MS * 2 ** attempt));
      }
    }
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}
