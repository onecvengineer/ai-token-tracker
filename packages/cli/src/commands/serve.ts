import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { withErrorHandling } from './shared.js';

interface WebRuntimeState {
  port: string;
  apiPid: number;
  webPid: number;
}

function getRepoRoot(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return resolve(currentDir, '../../../../');
}

function getRuntimeStatePath(): string {
  return resolve(homedir(), '.att', 'web-runtime.json');
}

async function ensureRuntimeDir(): Promise<void> {
  await mkdir(resolve(homedir(), '.att'), { recursive: true });
}

async function readRuntimeState(): Promise<WebRuntimeState | null> {
  const statePath = getRuntimeStatePath();
  if (!existsSync(statePath)) return null;

  try {
    return JSON.parse(await readFile(statePath, 'utf-8')) as WebRuntimeState;
  } catch {
    return null;
  }
}

async function writeRuntimeState(state: WebRuntimeState): Promise<void> {
  await ensureRuntimeDir();
  await writeFile(getRuntimeStatePath(), JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

async function clearRuntimeState(): Promise<void> {
  const statePath = getRuntimeStatePath();
  if (existsSync(statePath)) {
    await rm(statePath, { force: true });
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killProcessGroup(pid: number): void {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {}
}

function startApiChild(port: string): ChildProcess {
  const repoRoot = getRepoRoot();
  const apiEntry = resolve(repoRoot, 'packages/api/dist/index.js');

  return spawn(process.execPath, [apiEntry], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ATT_PORT: port,
    },
  });
}

function startWebChild(port: string): ChildProcess {
  const repoRoot = getRepoRoot();
  const webDir = resolve(repoRoot, 'packages/web');

  return spawn('pnpm', ['--dir', webDir, 'dev'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ATT_PORT: port,
    },
  });
}

function startDetachedApiChild(port: string): ChildProcess {
  const repoRoot = getRepoRoot();
  const apiEntry = resolve(repoRoot, 'packages/api/dist/index.js');

  return spawn(process.execPath, [apiEntry], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      ATT_PORT: port,
    },
  });
}

function startDetachedWebChild(port: string): ChildProcess {
  const repoRoot = getRepoRoot();
  const webDir = resolve(repoRoot, 'packages/web');

  return spawn('pnpm', ['--dir', webDir, 'dev'], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      ATT_PORT: port,
    },
  });
}

async function stopDetachedWebRuntime(): Promise<boolean> {
  const state = await readRuntimeState();
  if (!state) {
    return false;
  }

  if (isProcessAlive(state.apiPid)) {
    killProcessGroup(state.apiPid);
  }
  if (isProcessAlive(state.webPid)) {
    killProcessGroup(state.webPid);
  }

  await clearRuntimeState();
  return true;
}

async function startDetachedWebRuntime(port: string): Promise<void> {
  const existing = await readRuntimeState();
  if (existing && (isProcessAlive(existing.apiPid) || isProcessAlive(existing.webPid))) {
    throw new Error(`Web runtime is already running on port ${existing.port}. Use "att web stop" first.`);
  }
  if (existing) {
    await clearRuntimeState();
  }

  const apiChild = startDetachedApiChild(port);
  const webChild = startDetachedWebChild(port);

  if (!apiChild.pid || !webChild.pid) {
    throw new Error('Failed to start detached web runtime');
  }

  apiChild.unref();
  webChild.unref();

  await writeRuntimeState({
    port,
    apiPid: apiChild.pid,
    webPid: webChild.pid,
  });

  console.log(`ATT web runtime started in background.`);
  console.log(`API: http://localhost:${port}`);
  console.log(`Web: http://localhost:3457`);
  console.log(`Stop with: att web stop`);
}

async function runApiWithWeb(port: string): Promise<void> {
  const apiChild = startApiChild(port);
  const webChild = startWebChild(port);

  const cleanup = () => {
    if (apiChild.exitCode === null && apiChild.signalCode === null) {
      apiChild.kill('SIGTERM');
    }
    if (webChild.exitCode === null && webChild.signalCode === null) {
      webChild.kill('SIGTERM');
    }
  };

  process.once('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.once('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  apiChild.once('exit', (code) => {
    cleanup();
    process.exit(code ?? 0);
  });

  webChild.once('exit', (code) => {
    cleanup();
    process.exit(code ?? 0);
  });
}

export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description('Start the API server')
    .option('-p, --port <port>', 'Port number', '3456')
    .option('--web', 'Start the API server and web frontend together')
    .option('-d, --detach', 'Run web mode in background')
    .addHelpText('after', `
Examples:
  att serve
  att serve --port 8080
  att serve --web
  att serve --web --detach
`)
    .action(withErrorHandling(async (opts) => {
      if (opts.web) {
        if (opts.detach) {
          await startDetachedWebRuntime(opts.port);
          return;
        }
        await runApiWithWeb(opts.port);
        return;
      }

      process.env.ATT_PORT = opts.port;
      const { startServer } = await import('@att/api');
      startServer();
    }));

  const webCommand = program
    .command('web')
    .description('Start the API server and web frontend together')
    .option('-p, --port <port>', 'API port number', '3456')
    .option('-d, --detach', 'Run in background')
    .addHelpText('after', `
Examples:
  att web
  att web --port 8080
  att web --detach
  att web stop
`);

  webCommand
    .command('start')
    .description('Start the API server and web frontend together')
    .option('-p, --port <port>', 'API port number', '3456')
    .option('-d, --detach', 'Run in background')
    .action(withErrorHandling(async (opts) => {
      if (opts.detach) {
        await startDetachedWebRuntime(opts.port);
        return;
      }
      await runApiWithWeb(opts.port);
    }));

  const stopWebRuntime = withErrorHandling(async () => {
    const stopped = await stopDetachedWebRuntime();
    if (!stopped) {
      console.log('No detached ATT web runtime found.');
      return;
    }
    console.log('Detached ATT web runtime stopped.');
  });

  webCommand
    .command('stop')
    .description('Stop the detached web runtime')
    .action(stopWebRuntime);

  webCommand
    .action(withErrorHandling(async () => {
      const opts = webCommand.opts<{ port: string; detach?: boolean }>();
      if (opts.detach) {
        await startDetachedWebRuntime(opts.port);
        return;
      }
      await runApiWithWeb(opts.port);
    }));
}
