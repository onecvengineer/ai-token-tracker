import chalk from 'chalk';
import { resolveUsageWindow } from '@att/core';
import type { BalanceRateLimits, Source } from '@att/core';

const SOURCES: Source[] = ['claude-code', 'codex', 'hermes'];

export function withErrorHandling<T extends unknown[]>(
  fn: (...args: T) => Promise<void> | void,
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(message));
      process.exitCode = 1;
    }
  };
}

export function parseSource(value?: string, fallback?: Source): Source | undefined {
  if (!value) return fallback;
  if (!SOURCES.includes(value as Source)) {
    throw new Error(`Unsupported source "${value}". Expected one of: ${SOURCES.join(', ')}`);
  }
  return value as Source;
}

export function resolveCLIUsageQuery(opts: {
  start?: string;
  end?: string;
  preset?: string;
  source?: string;
}): ReturnType<typeof resolveUsageWindow> {
  return resolveUsageWindow({
    start: opts.start,
    end: opts.end,
    preset: opts.preset,
    source: parseSource(opts.source),
  });
}

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

export function formatStatus(status: 'active' | 'inactive' | 'unknown', isActive?: boolean): string {
  if (isActive) return chalk.green('Active');
  if (status === 'active') return chalk.green('Active');
  if (status === 'inactive') return chalk.gray('Inactive');
  return chalk.yellow('Unknown');
}

function formatResetTime(seconds: number): string {
  const resetAt = new Date(Date.now() + seconds * 1000);
  const hours = Math.floor(seconds / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  const timeStr = `${pad(resetAt.getHours())}:${pad(resetAt.getMinutes())}`;
  if (hours < 24) return timeStr;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d${remainingHours}h` : `${days}d`;
}

export function formatRateLimit(rateLimits: BalanceRateLimits | undefined): string {
  if (!rateLimits) return '-';
  const parts: string[] = [];
  if (rateLimits.primaryUsedPercent != null) {
    const left = 100 - rateLimits.primaryUsedPercent;
    const reset = rateLimits.primaryResetAfter ? formatResetTime(rateLimits.primaryResetAfter) : '';
    parts.push(`5h: ${left}%${reset ? ` (${reset})` : ''}`);
  }
  if (rateLimits.secondaryUsedPercent != null) {
    const left = 100 - rateLimits.secondaryUsedPercent;
    const reset = rateLimits.secondaryResetAfter ? formatResetTime(rateLimits.secondaryResetAfter) : '';
    parts.push(`7d: ${left}%${reset ? ` (${reset})` : ''}`);
  }
  return parts.length > 0 ? parts.join('\n') : '-';
}

export function printEmptyState(message: string): void {
  console.log(chalk.yellow(message));
}
