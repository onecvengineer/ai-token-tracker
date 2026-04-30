#!/usr/bin/env node
import { chmod, lstat, mkdir, symlink, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliEntry = resolve(repoRoot, 'packages/cli/dist/index.js');
const binDir = process.env.ATT_BIN_DIR || resolve(homedir(), '.local/bin');
const binPath = resolve(binDir, process.platform === 'win32' ? 'att.cmd' : 'att');

async function main() {
  if (!existsSync(cliEntry)) {
    console.warn(`att link skipped: ${cliEntry} does not exist yet. Run pnpm build first.`);
    return;
  }

  await mkdir(binDir, { recursive: true });

  if (process.platform === 'win32') {
    await writeWindowsShim();
  } else {
    await chmod(cliEntry, 0o755);
    const linked = await replaceSymlink();
    if (!linked) return;
  }

  console.log(`att linked: ${binPath}`);
  if (!isPathVisible(binDir)) {
    console.warn(`Add ${binDir} to PATH before running att from a new shell.`);
  }
}

async function replaceSymlink() {
  if (existsSync(binPath)) {
    const stat = await lstat(binPath);
    if (!stat.isSymbolicLink()) {
      console.warn(`att link skipped: ${binPath} already exists and is not a symlink.`);
      console.warn(`Remove it or set ATT_BIN_DIR to another directory, then rerun pnpm --filter @att/cli build.`);
      return false;
    }
    await unlink(binPath);
  }

  await symlink(cliEntry, binPath);
  return true;
}

async function writeWindowsShim() {
  const { writeFile } = await import('node:fs/promises');
  const content = `@echo off\r\nnode "${cliEntry}" %*\r\n`;
  await writeFile(binPath, content, 'utf-8');
}

function isPathVisible(dir) {
  const pathValue = process.env.PATH || '';
  return pathValue.split(process.platform === 'win32' ? ';' : ':').includes(dir);
}

main().catch((error) => {
  console.warn(`att link skipped: ${error instanceof Error ? error.message : String(error)}`);
});
