#!/usr/bin/env node
// Starts the RolePlay platform with one command.
//
//   node scripts/launch.mjs             the app: build the web UI, start the server, open the browser
//   node scripts/launch.mjs dev         server and web UI that reload on change, for working on the code
//   node scripts/launch.mjs --no-open   as above, without opening the browser
//
// run.bat (Windows) and run.sh (macOS, Linux) call this. It installs
// dependencies when they are missing, so it also works on a fresh checkout.
// The port and address come from RP_PORT and RP_HOST, in the environment or
// in .env, like the server's own.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const args = process.argv.slice(2);
const dev = args.includes('dev');
const openBrowser = !args.includes('--no-open');

// --- wording ------------------------------------------------------------------

const zh = /^zh/i.test(Intl.DateTimeFormat().resolvedOptions().locale) || /zh/i.test(process.env.LANG ?? '');
const TEXT = {
  nodeTooOld: [
    (have) => `Node.js ${have} is too old: this needs 20.12 or newer. Get it from https://nodejs.org and run this again.`,
    (have) => `当前的 Node.js 是 ${have}，版本太旧：需要 20.12 或更高版本。请到 https://nodejs.org 安装后再运行。`,
  ],
  installing: ['Installing dependencies (first run only)...', '正在安装依赖（只有第一次需要）……'],
  building: ['Building the web UI...', '正在构建网页界面……'],
  starting: ['Starting the server...', '正在启动服务器……'],
  startingDev: ['Starting the server and the web UI in development mode...', '正在以开发模式启动服务器和网页界面……'],
  ready: [(url) => `\nRolePlay is running at ${url}\nPress Ctrl+C in this window to stop it.\n`, (url) => `\nRolePlay 已经启动：${url}\n在这个窗口里按 Ctrl+C 可以停止。\n`],
  already: [(url) => `RolePlay is already running at ${url}. Opening it.`, (url) => `RolePlay 已经在运行：${url}，直接为你打开。`],
  alreadyDev: [
    (port) => `RolePlay is already running on port ${port}. Stop it first (Ctrl+C in its window), then start development mode again.`,
    (port) => `RolePlay 已经在端口 ${port} 上运行。请先停掉它（在它的窗口里按 Ctrl+C），再启动开发模式。`,
  ],
  portTaken: [
    (port) => `Port ${port} is in use by another program. Close it, or choose another port by adding a line like RP_PORT=8790 to the .env file.`,
    (port) => `端口 ${port} 被别的程序占用了。请关掉它，或者在 .env 文件里加一行 RP_PORT=8790 换一个端口。`,
  ],
  failed: [(what, code) => `"${what}" failed (exit code ${code}).`, (what, code) => `“${what}”执行失败（退出码 ${code}）。`],
  noAnswer: ['The server did not answer in time. Look at the messages above for what went wrong.', '服务器迟迟没有响应。请看上面的输出，找出哪里出了问题。'],
};
const say = (key, ...values) => {
  const text = TEXT[key][zh ? 1 : 0];
  console.log(typeof text === 'function' ? text(...values) : text);
};

// --- settings the server will also read -----------------------------------------

/** A setting from the environment, or from .env when the environment does not have it. */
function setting(name) {
  if (process.env[name]) return process.env[name];
  const envFile = path.join(root, '.env');
  if (!existsSync(envFile)) return undefined;
  const line = readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith(`${name}=`));
  return line?.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') || undefined;
}

const port = Number(setting('RP_PORT')) || 8787;
const host = setting('RP_HOST') || '127.0.0.1';
// An address the server listens on for everyone is not one a browser can open.
const reachable = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
const browserHost = reachable === '127.0.0.1' ? 'localhost' : reachable;
const appUrl = `http://${browserHost}:${dev ? 5173 : port}`;

// --- helpers ------------------------------------------------------------------

/** Runs a command in the repository and resolves with its exit code. Output goes straight to this window. */
function run(command) {
  return new Promise((resolve) => {
    // One command line, run by the shell: npm is a .cmd file on Windows.
    const child = spawn(command, { cwd: root, stdio: 'inherit', shell: true });
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

async function must(command) {
  const code = await run(command);
  if (code !== 0) {
    say('failed', command, code);
    process.exit(code);
  }
}

/** Whether this app's server answers on the port. */
async function serverAnswers() {
  try {
    const response = await fetch(`http://${reachable}:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    return response.ok && (await response.json()).ok === true;
  } catch {
    return false;
  }
}

/** Whether anything at all is listening on the port. */
function portInUse() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: reachable, port });
    const settle = (inUse) => {
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(1500, () => settle(false));
    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
  });
}

async function answers(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

/** Waits until `check` holds, for up to a minute. */
async function until(check) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function open(url) {
  if (!openBrowser) return;
  const command = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  // A browser that will not open is no reason to stop: the address is printed either way.
  spawn(command, { shell: true, stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

// --- start --------------------------------------------------------------------

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 20 || (major === 20 && minor < 12)) {
  say('nodeTooOld', process.versions.node);
  process.exit(1);
}

if (await serverAnswers()) {
  // Development mode needs the port for a server of its own.
  if (dev) {
    say('alreadyDev', port);
    process.exit(1);
  }
  say('already', appUrl);
  open(appUrl);
  process.exit(0);
}
if (await portInUse()) {
  say('portTaken', port);
  process.exit(1);
}

if (!existsSync(path.join(root, 'node_modules', '.bin'))) {
  say('installing');
  await must('npm install');
}

if (dev) {
  say('startingDev');
} else {
  say('building');
  await must('npm run build');
  say('starting');
}

const server = spawn(dev ? 'npm run dev' : 'npm run start', { cwd: root, stdio: 'inherit', shell: true });
server.on('exit', (code) => process.exit(code ?? 0));
// Ctrl+C reaches the server by itself; this window only has to wait for it to finish.
process.on('SIGINT', () => {});

const up = await until(async () => (await serverAnswers()) && (!dev || (await answers(appUrl))));
if (up) {
  say('ready', appUrl);
  open(appUrl);
} else {
  say('noAnswer');
}
