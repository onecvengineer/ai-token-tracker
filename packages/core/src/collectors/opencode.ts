import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';
import type { ICollector, CollectorResult, UsageRecord, DailyUsage, Source } from './types.js';

interface OpenCodeMessage {
  id: string;
  session_id: string;
  time_created: number;
  data: string;
}

interface MessageData {
  role?: string;
  agent?: string;
  variant?: string;
  mode?: string;
  tokens?: {
    total?: number;
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
  cost?: number;
  modelID?: string;
  providerID?: string;
  time?: { created?: number };
  finish?: string;
}

export class OpenCodeCollector implements ICollector {
  readonly source: Source = 'opencode';
  private readonly dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? join(homedir(), '.local', 'share', 'opencode', 'opencode.db');
  }

  async isAvailable(): Promise<boolean> {
    return existsSync(this.dbPath);
  }

  async collect(): Promise<CollectorResult> {
    const db = new Database(this.dbPath, { readonly: true });
    try {
      const messages = db.prepare(`
        SELECT id, session_id, time_created, data
        FROM message
        WHERE json_extract(data, '$.role') = 'assistant'
          AND json_extract(data, '$.tokens') IS NOT NULL
        ORDER BY time_created ASC
      `).all() as OpenCodeMessage[];

      const records: UsageRecord[] = [];
      const dailyMap = new Map<string, DailyUsage>();

      for (const msg of messages) {
        const parsed = JSON.parse(msg.data) as MessageData;
        const tokens = parsed.tokens!;
        const totalTokens = tokens.total ?? 0;
        if (totalTokens === 0) continue;

        const inputTokens = tokens.input ?? 0;
        const outputTokens = tokens.output ?? 0;
        const cacheReadTokens = tokens.cache?.read ?? 0;
        const model = parsed.modelID || 'unknown';
        const costUSD = parsed.cost != null ? parsed.cost : null;

        const createdAt = parsed.time?.created ?? msg.time_created;
        const date = new Date(createdAt).toISOString().split('T')[0];

        records.push({
          id: `opencode-${msg.id}`,
          source: 'opencode',
          model,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          totalTokens,
          costUSD,
          sessionId: msg.session_id,
          usageDate: date,
          recordedAt: new Date(createdAt).toISOString(),
          metadata: {
            agent: parsed.agent,
            variant: parsed.variant,
            finish: parsed.finish,
            reasoningTokens: tokens.reasoning ?? 0,
            cacheWriteTokens: tokens.cache?.write ?? 0,
          },
        });

        const key = `${date}-${model}`;
        const existing = dailyMap.get(key);
        if (existing) {
          existing.inputTokens += inputTokens;
          existing.outputTokens += outputTokens;
          existing.cacheReadTokens += cacheReadTokens;
          existing.totalTokens += totalTokens;
          if (costUSD != null) {
            existing.costUSD = (existing.costUSD ?? 0) + costUSD;
          }
          existing.messageCount += 1;
        } else {
          dailyMap.set(key, {
            date,
            source: 'opencode',
            model,
            inputTokens,
            outputTokens,
            cacheReadTokens,
            totalTokens,
            costUSD,
            messageCount: 1,
            sessionCount: 0,
            toolCallCount: 0,
          });
        }
      }

      // Count unique sessions per day + model
      const sessionCounts = db.prepare(`
        SELECT date(COALESCE(json_extract(m.data, '$.time.created'), m.time_created) / 1000, 'unixepoch') as day,
               COALESCE(json_extract(m.data, '$.modelID'), 'unknown') as model,
               COUNT(DISTINCT m.session_id) as session_count
        FROM message m
        WHERE json_extract(m.data, '$.role') = 'assistant'
          AND json_extract(m.data, '$.tokens') IS NOT NULL
          AND COALESCE(json_extract(m.data, '$.tokens.total'), 0) != 0
        GROUP BY day, model
      `).all() as { day: string; model: string; session_count: number }[];

      for (const row of sessionCounts) {
        const key = `${row.day}-${row.model}`;
        const daily = dailyMap.get(key);
        if (daily) {
          daily.sessionCount = row.session_count;
        }
      }

      return { records, dailyUsage: Array.from(dailyMap.values()) };
    } finally {
      db.close();
    }
  }
}
