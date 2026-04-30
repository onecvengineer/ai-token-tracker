import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
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

interface SpawnCommand {
  command: string;
  args: string[];
}

const WEB_PORT = '3457';

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
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {}
}

function killWindowsPortProcesses(ports: string[]): void {
  if (process.platform !== 'win32') return;

  const portSet = new Set(ports);
  const result = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf-8' });
  if (result.error || !result.stdout) return;

  for (const line of result.stdout.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 5 || columns[0] !== 'TCP' || columns[3] !== 'LISTENING') {
      continue;
    }

    const port = columns[1].split(':').at(-1);
    const pid = Number(columns[4]);
    if (port && portSet.has(port) && Number.isInteger(pid) && pid > 0) {
      killProcessGroup(pid);
    }
  }
}

function getPnpmCommand(): SpawnCommand {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath?.toLowerCase().includes('pnpm') && existsSync(npmExecPath)) {
    return {
      command: process.execPath,
      args: [npmExecPath],
    };
  }

  const candidates = [
    process.env.APPDATA ? resolve(process.env.APPDATA, 'npm/node_modules/pnpm/bin/pnpm.cjs') : null,
    process.env.LOCALAPPDATA ? resolve(process.env.LOCALAPPDATA, 'pnpm/global/5/node_modules/pnpm/bin/pnpm.cjs') : null,
    resolve(getRepoRoot(), 'node_modules/pnpm/bin/pnpm.cjs'),
  ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return {
        command: process.execPath,
        args: [candidate],
      };
    }
  }

  if (process.platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'pnpm'],
    };
  }

  return {
    command: 'pnpm',
    args: [],
  };
}

function getWebCommand(webDir: string): SpawnCommand {
  const pnpm = getPnpmCommand();
  return {
    command: pnpm.command,
    args: [...pnpm.args, '--dir', webDir, 'dev'],
  };
}

function waitForChildSpawn(child: ChildProcess, label: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('error', onError);
      child.off('exit', onExit);
      callback();
    };

    const onError = (error: Error) => {
      finish(() => reject(new Error(`Failed to start ${label}: ${error.message}`)));
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish(() => reject(new Error(`${label} exited during startup with ${signal ?? `code ${code ?? 0}`}`)));
    };

    const timer = setTimeout(() => {
      finish(resolvePromise);
    }, 250);

    child.once('error', onError);
    child.once('exit', onExit);
  });
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
  const webCommand = getWebCommand(webDir);

  return spawn(webCommand.command, webCommand.args, {
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
  const webCommand = getWebCommand(webDir);

  return spawn(webCommand.command, webCommand.args, {
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
  killWindowsPortProcesses([state.port, WEB_PORT]);

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

  try {
    await Promise.all([
      waitForChildSpawn(apiChild, 'detached API runtime'),
      waitForChildSpawn(webChild, 'detached web runtime'),
    ]);
  } catch (error) {
    if (apiChild.pid && isProcessAlive(apiChild.pid)) {
      killProcessGroup(apiChild.pid);
    }
    if (webChild.pid && isProcessAlive(webChild.pid)) {
      killProcessGroup(webChild.pid);
    }
    throw error;
  }

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
  console.log(`Web: http://localhost:${WEB_PORT}`);
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

  apiChild.once('error', (error) => {
    cleanup();
    console.error(`Failed to start API runtime: ${error.message}`);
    process.exit(1);
  });

  webChild.once('error', (error) => {
    cleanup();
    console.error(`Failed to start web runtime: ${error.message}`);
    process.exit(1);
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
