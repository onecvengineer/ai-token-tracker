import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';
import type { ICollector, CollectorResult, UsageRecord, DailyUsage, Source } from './types.js';

interface CodexThread {
  id: string;
  rollout_path: string;
  model_provider: string;
  model: string | null;
  tokens_used: number;
  created_at: number;
  updated_at: number;
  title: string;
  cwd: string;
  archived: number;
}

interface TurnUsage {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
}

interface RateLimits {
  limit_id: string;
  primary?: { used_percent: number; window_minutes: number; resets_at: number };
  secondary?: { used_percent: number; window_minutes: number; resets_at: number };
  plan_type?: string;
}

interface RolloutSummary {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  turnCount: number;
  rateLimits?: RateLimits;
  recordedAt: string;
}

function usageDelta(previous: TurnUsage | null, current: TurnUsage): TurnUsage {
  if (!previous) return current;

  return {
    input_tokens: Math.max(0, (current.input_tokens || 0) - (previous.input_tokens || 0)),
    cached_input_tokens: Math.max(0, (current.cached_input_tokens || 0) - (previous.cached_input_tokens || 0)),
    output_tokens: Math.max(0, (current.output_tokens || 0) - (previous.output_tokens || 0)),
    reasoning_output_tokens: Math.max(0, (current.reasoning_output_tokens || 0) - (previous.reasoning_output_tokens || 0)),
    total_tokens: Math.max(0, (current.total_tokens || 0) - (previous.total_tokens || 0)),
  };
}

function hasUsage(usage: TurnUsage): boolean {
  return usage.input_tokens > 0 || usage.output_tokens > 0 || usage.total_tokens > 0;
}

function isoDateFromTimestamp(value: unknown): { date: string; recordedAt: string } {
  const recordedAt = typeof value === 'string' ? value : new Date().toISOString();
  const parsed = new Date(recordedAt);
  if (Number.isNaN(parsed.getTime())) {
    const now = new Date().toISOString();
    return { date: now.split('T')[0], recordedAt: now };
  }
  return { date: parsed.toISOString().split('T')[0], recordedAt };
}

function parseRolloutFile(filePath: string): RolloutSummary[] {
  const dailyMap = new Map<string, RolloutSummary>();
  let previousUsage: TurnUsage | null = null;
  let rateLimits: RateLimits | undefined;

  const content = readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'event_msg') {
        if (entry.payload?.rate_limits) {
          rateLimits = entry.payload.rate_limits;
        }

        const info = entry.payload?.info;
        if (info?.total_token_usage) {
          const currentUsage = info.total_token_usage as TurnUsage;
          const delta = usageDelta(previousUsage, currentUsage);
          previousUsage = currentUsage;

          if (!hasUsage(delta)) continue;

          const { date, recordedAt } = isoDateFromTimestamp(entry.timestamp);
          const existing = dailyMap.get(date);

          if (existing) {
            existing.inputTokens += delta.input_tokens || 0;
            existing.outputTokens += delta.output_tokens || 0;
            existing.cacheReadTokens += delta.cached_input_tokens || 0;
            existing.totalTokens += delta.total_tokens || 0;
            existing.turnCount += 1;
            existing.rateLimits = rateLimits ?? existing.rateLimits;
            existing.recordedAt = recordedAt;
          } else {
            dailyMap.set(date, {
              date,
              inputTokens: delta.input_tokens || 0,
              outputTokens: delta.output_tokens || 0,
              cacheReadTokens: delta.cached_input_tokens || 0,
              totalTokens: delta.total_tokens || 0,
              turnCount: 1,
              rateLimits,
              recordedAt,
            });
          }
        }
      }
    } catch {}
  }

  return Array.from(dailyMap.values());
}

export class CodexCollector implements ICollector {
  readonly source: Source = 'codex';
  private readonly codexDir: string;
  private readonly dbPath: string;

  constructor(codexDir?: string) {
    this.codexDir = codexDir ?? join(homedir(), '.codex');
    this.dbPath = join(this.codexDir, 'state_5.sqlite');
  }

  async isAvailable(): Promise<boolean> {
    return existsSync(this.dbPath);
  }

  async collect(): Promise<CollectorResult> {
    if (!existsSync(this.dbPath)) {
      return { records: [], dailyUsage: [] };
    }

    const db = new Database(this.dbPath, { readonly: true });
    try {
      const threads = db.prepare(`
        SELECT id, rollout_path, model_provider, model, tokens_used, created_at, updated_at, title, cwd, archived
        FROM threads
        ORDER BY updated_at DESC
      `).all() as CodexThread[];

      // Parse rollout files for detailed token breakdown by actual event date.
      const rolloutMap = this.buildRolloutMap(threads);

      const records: UsageRecord[] = [];
      const dailyMap = new Map<string, DailyUsage>();

      for (const thread of threads) {
        if (thread.tokens_used === 0) continue;

        const model = thread.model || thread.model_provider || 'unknown';
        const updatedDate = new Date(thread.updated_at * 1000).toISOString().split('T')[0];

        // Use rollout data if available, otherwise fall back to aggregate
        const rollouts = rolloutMap.get(thread.id);

        if (rollouts?.length) {
          for (const rollout of rollouts) {
            records.push({
              id: `codex-${thread.id}-${rollout.date}`,
              source: 'codex',
              model,
              inputTokens: rollout.inputTokens,
              outputTokens: rollout.outputTokens,
              cacheReadTokens: rollout.cacheReadTokens,
              totalTokens: rollout.totalTokens,
              costUSD: null,
              sessionId: thread.id,
              usageDate: rollout.date,
              recordedAt: rollout.recordedAt,
              metadata: {
                title: thread.title,
                cwd: thread.cwd,
                provider: thread.model_provider,
                archived: thread.archived,
                hasDetailedUsage: true,
                planType: rollout.rateLimits?.plan_type,
                primaryUsedPercent: rollout.rateLimits?.primary?.used_percent,
              },
            });

            this.addDailyUsage(dailyMap, {
              date: rollout.date,
              source: 'codex',
              model,
              inputTokens: rollout.inputTokens,
              outputTokens: rollout.outputTokens,
              cacheReadTokens: rollout.cacheReadTokens,
              totalTokens: rollout.totalTokens,
              costUSD: null,
              messageCount: rollout.turnCount,
              sessionCount: 1,
              toolCallCount: 0,
            });
          }
        } else {
          // Fallback: only total available from threads table, no breakdown
          const fallback: DailyUsage = {
            date: updatedDate,
            source: 'codex',
            model,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            totalTokens: thread.tokens_used,
            costUSD: null,
            messageCount: 0,
            sessionCount: 1,
            toolCallCount: 0,
          };

          records.push({
            id: `codex-${thread.id}-${updatedDate}`,
            source: 'codex',
            model,
            inputTokens: fallback.inputTokens,
            outputTokens: fallback.outputTokens,
            cacheReadTokens: fallback.cacheReadTokens,
            totalTokens: fallback.totalTokens,
            costUSD: null,
            sessionId: thread.id,
            usageDate: updatedDate,
            recordedAt: new Date(thread.updated_at * 1000).toISOString(),
            metadata: {
              title: thread.title,
              cwd: thread.cwd,
              provider: thread.model_provider,
              archived: thread.archived,
              hasDetailedUsage: false,
            },
          });

          this.addDailyUsage(dailyMap, fallback);
        }
      }

      return { records, dailyUsage: Array.from(dailyMap.values()) };
    } finally {
      db.close();
    }
  }

  private addDailyUsage(dailyMap: Map<string, DailyUsage>, entry: DailyUsage): void {
    const key = `${entry.date}-${entry.model}`;
    const existing = dailyMap.get(key);

    if (existing) {
      existing.inputTokens += entry.inputTokens;
      existing.outputTokens += entry.outputTokens;
      existing.cacheReadTokens += entry.cacheReadTokens;
      existing.totalTokens += entry.totalTokens;
      existing.messageCount += entry.messageCount;
      existing.sessionCount += entry.sessionCount;
      existing.toolCallCount += entry.toolCallCount;
      return;
    }

    dailyMap.set(key, { ...entry });
  }

  private buildRolloutMap(threads: CodexThread[]): Map<string, RolloutSummary[]> {
    const map = new Map<string, RolloutSummary[]>();
    const sessionsDir = join(this.codexDir, 'sessions');

    for (const thread of threads) {
      if (!thread.rollout_path || !existsSync(thread.rollout_path)) continue;

      try {
        const rollouts = parseRolloutFile(thread.rollout_path);
        if (rollouts.length > 0) map.set(thread.id, rollouts);
      } catch {}
    }

    if (!existsSync(sessionsDir)) return map;

    const threadSet = new Set(threads.map(t => t.id));

    try {
      // Walk year/month/day directories
      const walkDir = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            walkDir(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            // Extract thread_id from filename: rollout-...-<thread_id>.jsonl
            const match = entry.name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/);
            if (!match) continue;
            const threadId = match[1];
            if (!threadSet.has(threadId)) continue;
            if (map.has(threadId)) continue;

            try {
              const rollouts = parseRolloutFile(fullPath);
              if (rollouts.length > 0) map.set(threadId, rollouts);
            } catch {}
          }
        }
      };

      walkDir(sessionsDir);
    } catch {}

    return map;
  }
}
