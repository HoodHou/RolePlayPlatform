import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Hono } from 'hono';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

/**
 * Serves the built web app so one process is enough in production. In
 * development the Vite dev server serves the UI and this only answers /api.
 */
export function serveWebApp(app: Hono, distDir: string): void {
  const root = path.resolve(distDir);
  const index = path.join(root, 'index.html');

  app.get('*', async (c) => {
    if (c.req.path.startsWith('/api/')) return c.notFound();

    if (!(await isFile(index))) {
      return c.text(
        'The web app has not been built. Run "npm run dev" and open the Vite URL, or run "npm run build" first.',
        404,
      );
    }

    // Resolve inside the build folder only; anything else falls through to the app shell.
    const requested = path.resolve(root, `.${decodeURIComponent(c.req.path)}`);
    const inside = requested === root || requested.startsWith(root + path.sep);
    const file = inside && (await isFile(requested)) ? requested : index;

    const type = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    // Hashed assets never change; the shell must always be fresh.
    const cache = file === index ? 'no-cache' : 'public, max-age=31536000, immutable';
    return c.body(await readFile(file), 200, { 'Content-Type': type, 'Cache-Control': cache });
  });
}
