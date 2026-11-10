import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../../..');

export interface ServerConfig {
  port: number;
  host: string;
  /** Where sessions and settings are stored. */
  dataDir: string;
  /** Built web app, served by this process when it exists. */
  webDist: string;
}

/** Loads the repo-level .env, if there is one, into process.env. */
export function loadEnvFile(): void {
  const envPath = path.join(REPO_ROOT, '.env');
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  // Prefixed names only. Generic PORT and HOST are set by shells and dev tools
  // for their own purposes (zsh exports HOST as the machine name; preview
  // tools export the web app's PORT to the whole process tree).
  return {
    port: Number(env.RP_PORT) || 8787,
    host: env.RP_HOST || '127.0.0.1',
    dataDir: path.resolve(REPO_ROOT, env.RP_DATA_DIR || 'data'),
    webDist: path.join(REPO_ROOT, 'apps', 'web', 'dist'),
  };
}
