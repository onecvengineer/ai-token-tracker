import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';
import type { ICollector, CollectorResult, UsageRecord, DailyUsage, Source } from './types.js';

interface CodexThread {
  id: string;
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
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  turnCount: number;
  rateLimits?: RateLimits;
}

function parseRolloutFile(filePath: string): { lastUsage: TurnUsage | null; turnCount: number; rateLimits?: RateLimits } {
  let lastUsage: TurnUsage | null = null;
  let turnCount = 0;
  let rateLimits: RateLimits | undefined;

  const content = readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'event_msg') {
        const info = entry.payload?.info;
        if (info?.total_token_usage) {
          // Values are cumulative — only keep the latest
          lastUsage = info.total_token_usage;
          turnCount++;
        }
        if (entry.payload?.rate_limits) {
          rateLimits = entry.payload.rate_limits;
        }
      }
    } catch {}
  }

  return { lastUsage, turnCount, rateLimits };
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
        SELECT id, model_provider, model, tokens_used, created_at, updated_at, title, cwd, archived
        FROM threads
        ORDER BY updated_at DESC
      `).all() as CodexThread[];

      // Parse rollout files for detailed token breakdown
      const rolloutMap = this.buildRolloutMap(threads);

      const records: UsageRecord[] = [];
      const dailyMap = new Map<string, DailyUsage>();

      for (const thread of threads) {
        if (thread.tokens_used === 0) continue;

        const model = thread.model || thread.model_provider || 'unknown';
        const updatedDate = new Date(thread.updated_at * 1000).toISOString().split('T')[0];

        // Use rollout data if available, otherwise fall back to aggregate
        const rollout = rolloutMap.get(thread.id);
        let inputTokens: number, outputTokens: number, cacheReadTokens: number, totalTokens: number;
        let rateLimits: RateLimits | undefined;

        if (rollout) {
          inputTokens = rollout.inputTokens;
          outputTokens = rollout.outputTokens;
          cacheReadTokens = rollout.cacheReadTokens;
          totalTokens = rollout.totalTokens;
          rateLimits = rollout.rateLimits;
        } else {
          // Fallback: only total available from threads table
          inputTokens = thread.tokens_used;
          outputTokens = 0;
          cacheReadTokens = 0;
          totalTokens = thread.tokens_used;
        }

        records.push({
          id: `codex-${thread.id}`,
          source: 'codex',
          model,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          totalTokens,
          costUSD: null,
          sessionId: thread.id,
          usageDate: updatedDate,
          recordedAt: new Date(thread.updated_at * 1000).toISOString(),
          metadata: {
            title: thread.title,
            cwd: thread.cwd,
            provider: thread.model_provider,
            archived: thread.archived,
            hasDetailedUsage: !!rollout,
            planType: rateLimits?.plan_type,
            primaryUsedPercent: rateLimits?.primary?.used_percent,
          },
        });

        // Aggregate daily
        const key = `${updatedDate}-${model}`;
        const existing = dailyMap.get(key);
        if (existing) {
          existing.inputTokens += inputTokens;
          existing.outputTokens += outputTokens;
          existing.cacheReadTokens += cacheReadTokens;
          existing.totalTokens += totalTokens;
          existing.sessionCount += 1;
        } else {
          dailyMap.set(key, {
            date: updatedDate,
            source: 'codex',
            model,
            inputTokens,
            outputTokens,
            cacheReadTokens,
            totalTokens,
            costUSD: null,
            messageCount: rollout?.turnCount ?? 0,
            sessionCount: 1,
            toolCallCount: 0,
          });
        }
      }

      return { records, dailyUsage: Array.from(dailyMap.values()) };
    } finally {
      db.close();
    }
  }

  private buildRolloutMap(threads: CodexThread[]): Map<string, RolloutSummary> {
    const map = new Map<string, RolloutSummary>();
    const sessionsDir = join(this.codexDir, 'sessions');

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

            try {
              const { lastUsage, turnCount, rateLimits } = parseRolloutFile(fullPath);
              if (!lastUsage) continue;

              const summary: RolloutSummary = {
                inputTokens: lastUsage.input_tokens || 0,
                outputTokens: lastUsage.output_tokens || 0,
                cacheReadTokens: lastUsage.cached_input_tokens || 0,
                totalTokens: lastUsage.total_tokens || 0,
                turnCount,
                rateLimits,
              };

              map.set(threadId, summary);
            } catch {}
          }
        }
      };

      walkDir(sessionsDir);
    } catch {}

    return map;
  }
}
