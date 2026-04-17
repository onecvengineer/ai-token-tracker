import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';
import type { ICollector, CollectorResult, UsageRecord, DailyUsage, Source } from './types.js';

interface HermesSession {
  session_key: string;
  session_id: string;
  created_at: string;
  updated_at: string;
  display_name: string | null;
  platform: string;
  chat_type: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  last_prompt_tokens: number;
  estimated_cost_usd: number;
  cost_status: string;
  model?: string;
}

interface HermesDBSession {
  id: string;
  source: string;
  model: string | null;
  started_at: number;
  ended_at: number | null;
  message_count: number;
  tool_call_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  title: string | null;
}

export class HermesCollector implements ICollector {
  readonly source: Source = 'hermes';
  private readonly hermesDir: string;
  private readonly sessionsJsonPath: string;
  private readonly stateDbPath: string;

  constructor(hermesDir?: string) {
    this.hermesDir = hermesDir ?? join(homedir(), '.hermes');
    this.sessionsJsonPath = join(this.hermesDir, 'sessions', 'sessions.json');
    this.stateDbPath = join(this.hermesDir, 'state.db');
  }

  async isAvailable(): Promise<boolean> {
    return existsSync(this.hermesDir);
  }

  async collect(): Promise<CollectorResult> {
    const records: UsageRecord[] = [];
    const dailyUsage: DailyUsage[] = [];

    // Try state.db first (more detailed data)
    if (existsSync(this.stateDbPath)) {
      const dbData = this.collectFromDB();
      records.push(...dbData.records);
      dailyUsage.push(...dbData.dailyUsage);
    }

    // Supplement with sessions.json (has platform info)
    if (existsSync(this.sessionsJsonPath)) {
      const jsonData = await this.collectFromSessionsJson();
      // Merge: prefer DB data, fill gaps from JSON
      const existingIds = new Set(records.map(r => r.sessionId));
      for (const r of jsonData.records) {
        if (!existingIds.has(r.sessionId)) {
          records.push(r);
        }
      }
      // Merge daily usage
      const existingDaily = new Set(dailyUsage.map(d => `${d.date}-${d.model}`));
      for (const d of jsonData.dailyUsage) {
        if (!existingDaily.has(`${d.date}-${d.model}`)) {
          dailyUsage.push(d);
        }
      }
    }

    return { records, dailyUsage };
  }

  private collectFromDB(): CollectorResult {
    const db = new Database(this.stateDbPath, { readonly: true });
    try {
      const sessions = db.prepare(`
        SELECT id, source, model, started_at, ended_at, message_count, tool_call_count,
               input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
               reasoning_tokens, estimated_cost_usd, actual_cost_usd, title
        FROM sessions
        ORDER BY started_at DESC
      `).all() as HermesDBSession[];

      const records: UsageRecord[] = [];
      const dailyMap = new Map<string, DailyUsage>();

      for (const session of sessions) {
        const totalTokens = session.input_tokens + session.output_tokens +
          session.cache_read_tokens + session.cache_write_tokens;
        if (totalTokens === 0) continue;

        const model = session.model || 'unknown';
        const date = new Date(session.started_at * 1000).toISOString().split('T')[0];

        records.push({
          id: `hermes-${session.id}`,
          source: 'hermes',
          model,
          inputTokens: session.input_tokens,
          outputTokens: session.output_tokens,
          cacheReadTokens: session.cache_read_tokens,
          totalTokens,
          costUSD: session.actual_cost_usd ?? session.estimated_cost_usd ?? null,
          sessionId: session.id,
          usageDate: date,
          recordedAt: new Date(session.started_at * 1000).toISOString(),
          metadata: {
            title: session.title,
            messageCount: session.message_count,
            toolCallCount: session.tool_call_count,
          },
        });

        const key = `${date}-${model}`;
        const existing = dailyMap.get(key);
        if (existing) {
          existing.inputTokens += session.input_tokens;
          existing.outputTokens += session.output_tokens;
          existing.cacheReadTokens += session.cache_read_tokens;
          existing.totalTokens += totalTokens;
          existing.costUSD = (existing.costUSD ?? 0) + (session.estimated_cost_usd ?? 0);
          existing.messageCount += session.message_count;
          existing.sessionCount += 1;
          existing.toolCallCount += session.tool_call_count;
        } else {
          dailyMap.set(key, {
            date,
            source: 'hermes',
            model,
            inputTokens: session.input_tokens,
            outputTokens: session.output_tokens,
            cacheReadTokens: session.cache_read_tokens,
            totalTokens,
            costUSD: session.estimated_cost_usd ?? null,
            messageCount: session.message_count,
            sessionCount: 1,
            toolCallCount: session.tool_call_count,
          });
        }
      }

      return { records, dailyUsage: Array.from(dailyMap.values()) };
    } finally {
      db.close();
    }
  }

  private async collectFromSessionsJson(): Promise<CollectorResult> {
    const raw = await readFile(this.sessionsJsonPath, 'utf-8');
    const sessions: Record<string, HermesSession> = JSON.parse(raw);

    const records: UsageRecord[] = [];
    const dailyMap = new Map<string, DailyUsage>();

    for (const session of Object.values(sessions)) {
      const totalTokens = session.total_tokens ||
        (session.input_tokens + session.output_tokens + session.cache_read_tokens + session.cache_write_tokens);
      if (totalTokens === 0) continue;

      const model = 'unknown'; // sessions.json doesn't have model per session
      const date = session.updated_at?.split('T')[0] || session.created_at?.split('T')[0] || '';

      records.push({
        id: `hermes-json-${session.session_id}`,
        source: 'hermes',
        model,
        inputTokens: session.input_tokens,
        outputTokens: session.output_tokens,
        cacheReadTokens: session.cache_read_tokens,
        totalTokens,
        costUSD: session.estimated_cost_usd || null,
        sessionId: session.session_id,
        usageDate: date,
        recordedAt: session.updated_at || new Date().toISOString(),
        metadata: {
          platform: session.platform,
          chatType: session.chat_type,
          displayName: session.display_name,
        },
      });

      const key = `${date}-${model}`;
      const existing = dailyMap.get(key);
      if (existing) {
        existing.inputTokens += session.input_tokens;
        existing.outputTokens += session.output_tokens;
        existing.cacheReadTokens += session.cache_read_tokens;
        existing.totalTokens += totalTokens;
        existing.sessionCount += 1;
      } else {
        dailyMap.set(key, {
          date,
          source: 'hermes',
          model,
          inputTokens: session.input_tokens,
          outputTokens: session.output_tokens,
          cacheReadTokens: session.cache_read_tokens,
          totalTokens,
          costUSD: session.estimated_cost_usd || null,
          messageCount: 0,
          sessionCount: 1,
          toolCallCount: 0,
        });
      }
    }

    return { records, dailyUsage: Array.from(dailyMap.values()) };
  }
}
