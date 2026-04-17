import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, and, gte, lte, sql, desc } from 'drizzle-orm';
import type { UsageRecord, DailyUsage, UsageSummary, Source } from '../collectors/types.js';
import * as schema from './schema.js';

const DATA_DIR = join(homedir(), '.att');

export class Repository {
  private db: ReturnType<typeof drizzle>;
  private sqlite: Database.Database;

  constructor(dbPath?: string) {
    const dir = dbPath ? join(dbPath, '..') : DATA_DIR;
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const path = dbPath ?? join(DATA_DIR, 'data.db');
    this.sqlite = new Database(path);
    this.sqlite.pragma('journal_mode = WAL');
    this.db = drizzle(this.sqlite, { schema });
    this.migrate();
  }

  private migrate(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS usage_records (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL CHECK(source IN ('claude-code', 'codex', 'hermes')),
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL,
        session_id TEXT NOT NULL,
        usage_date TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        metadata TEXT
      );

      CREATE TABLE IF NOT EXISTS daily_usage (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        source TEXT NOT NULL CHECK(source IN ('claude-code', 'codex', 'hermes')),
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL,
        message_count INTEGER NOT NULL DEFAULT 0,
        session_count INTEGER NOT NULL DEFAULT 0,
        tool_call_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS sync_state (
        source TEXT PRIMARY KEY CHECK(source IN ('claude-code', 'codex', 'hermes')),
        last_sync_at TEXT NOT NULL,
        record_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL CHECK(source IN ('claude-code', 'codex', 'hermes')),
        name TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 0,
        config TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_usage_date ON usage_records(usage_date);
      CREATE INDEX IF NOT EXISTS idx_usage_source ON usage_records(source);
      CREATE INDEX IF NOT EXISTS idx_daily_date ON daily_usage(date);
      CREATE INDEX IF NOT EXISTS idx_daily_source ON daily_usage(source);
    `);

    // Older Claude syncs stored lifetime aggregates as dated usage records.
    // They corrupt any time-window query, so drop them on startup.
    this.sqlite.prepare(`
      DELETE FROM usage_records
      WHERE source = 'claude-code' AND session_id = 'aggregate'
    `).run();
  }

  // --- Sync operations ---

  upsertRecords(records: UsageRecord[]): void {
    const stmt = this.sqlite.prepare(`
      INSERT OR REPLACE INTO usage_records
      (id, source, model, input_tokens, output_tokens, cache_read_tokens, total_tokens, cost_usd, session_id, usage_date, recorded_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = this.sqlite.transaction((rows: UsageRecord[]) => {
      for (const r of rows) {
        stmt.run(
          r.id, r.source, r.model, r.inputTokens, r.outputTokens,
          r.cacheReadTokens, r.totalTokens, r.costUSD, r.sessionId,
          r.usageDate, r.recordedAt, r.metadata ? JSON.stringify(r.metadata) : null
        );
      }
    });

    tx(records);
  }

  upsertDailyUsage(entries: DailyUsage[]): void {
    const stmt = this.sqlite.prepare(`
      INSERT OR REPLACE INTO daily_usage
      (id, date, source, model, input_tokens, output_tokens, cache_read_tokens, total_tokens, cost_usd, message_count, session_count, tool_call_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = this.sqlite.transaction((rows: DailyUsage[]) => {
      for (const r of rows) {
        const id = `${r.date}-${r.source}-${r.model}`;
        stmt.run(
          id, r.date, r.source, r.model, r.inputTokens, r.outputTokens,
          r.cacheReadTokens, r.totalTokens, r.costUSD, r.messageCount,
          r.sessionCount, r.toolCallCount
        );
      }
    });

    tx(entries);
  }

  updateSyncState(source: Source, count: number): void {
    this.sqlite.prepare(`
      INSERT OR REPLACE INTO sync_state (source, last_sync_at, record_count)
      VALUES (?, ?, ?)
    `).run(source, new Date().toISOString(), count);
  }

  getSyncState(source: Source): { lastSyncAt: string; recordCount: number } | null {
    const row = this.sqlite.prepare(
      'SELECT last_sync_at, record_count FROM sync_state WHERE source = ?'
    ).get(source) as any;
    return row ? { lastSyncAt: row.last_sync_at, recordCount: row.record_count } : null;
  }

  // --- Query operations ---

  getUsageSummary(startDate?: string, endDate?: string, source?: Source): UsageSummary {
    let query = `
      SELECT
        source,
        LOWER(model) as model,
        SUM(input_tokens) as inputTokens,
        SUM(output_tokens) as outputTokens,
        SUM(cache_read_tokens) as cacheReadTokens,
        SUM(total_tokens) as totalTokens,
        SUM(cost_usd) as costUSD,
        SUM(message_count) as messageCount,
        SUM(session_count) as sessionCount
      FROM daily_usage
      WHERE 1=1
    `;
    const params: any[] = [];
    if (startDate) { query += ' AND date >= ?'; params.push(startDate); }
    if (endDate) { query += ' AND date <= ?'; params.push(endDate); }
    if (source) { query += ' AND source = ?'; params.push(source); }
    query += ' GROUP BY source, LOWER(model)';

    const rows = this.sqlite.prepare(query).all(...params) as any[];

    const summary: UsageSummary = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalTokens: 0,
      totalCostUSD: 0,
      totalSessions: 0,
      totalMessages: 0,
      bySource: {} as Record<Source, { inputTokens: number; outputTokens: number; cacheReadTokens: number; totalTokens: number; costUSD: number }>,
      byModel: {} as Record<string, { inputTokens: number; outputTokens: number; cacheReadTokens: number; totalTokens: number; costUSD: number }>,
    };

    for (const row of rows) {
      summary.totalInputTokens += row.inputTokens;
      summary.totalOutputTokens += row.outputTokens;
      summary.totalCacheReadTokens += row.cacheReadTokens;
      summary.totalTokens += row.totalTokens;
      summary.totalCostUSD += row.costUSD || 0;
      summary.totalMessages += row.messageCount || 0;
      summary.totalSessions += row.sessionCount || 0;

      const src = row.source as Source;
      if (!summary.bySource[src]) {
        summary.bySource[src] = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, totalTokens: 0, costUSD: 0 };
      }
      summary.bySource[src].inputTokens += row.inputTokens;
      summary.bySource[src].outputTokens += row.outputTokens;
      summary.bySource[src].cacheReadTokens += row.cacheReadTokens;
      summary.bySource[src].totalTokens += row.totalTokens;
      summary.bySource[src].costUSD += row.costUSD || 0;

      if (!summary.byModel[row.model]) {
        summary.byModel[row.model] = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, totalTokens: 0, costUSD: 0 };
      }
      summary.byModel[row.model].inputTokens += row.inputTokens;
      summary.byModel[row.model].outputTokens += row.outputTokens;
      summary.byModel[row.model].cacheReadTokens += row.cacheReadTokens;
      summary.byModel[row.model].totalTokens += row.totalTokens;
      summary.byModel[row.model].costUSD += row.costUSD || 0;
    }

    return summary;
  }

  getDailyUsage(startDate?: string, endDate?: string, source?: Source): DailyUsage[] {
    let query = `
      SELECT
        date,
        source,
        LOWER(model) as model,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        SUM(cache_read_tokens) as cache_read_tokens,
        SUM(total_tokens) as total_tokens,
        SUM(cost_usd) as cost_usd,
        SUM(message_count) as message_count,
        SUM(session_count) as session_count,
        SUM(tool_call_count) as tool_call_count
      FROM daily_usage
      WHERE 1=1
    `;
    const params: any[] = [];
    if (startDate) { query += ' AND date >= ?'; params.push(startDate); }
    if (endDate) { query += ' AND date <= ?'; params.push(endDate); }
    if (source) { query += ' AND source = ?'; params.push(source); }
    query += ' GROUP BY date, source, LOWER(model) ORDER BY date DESC, total_tokens DESC';

    const rows = this.sqlite.prepare(query).all(...params) as any[];
    return rows.map(r => ({
      date: r.date,
      source: r.source as Source,
      model: r.model,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      cacheReadTokens: r.cache_read_tokens,
      totalTokens: r.total_tokens,
      costUSD: r.cost_usd,
      messageCount: r.message_count,
      sessionCount: r.session_count,
      toolCallCount: r.tool_call_count,
    }));
  }

  getRecords(startDate?: string, endDate?: string, source?: Source, limit = 100): UsageRecord[] {
    let query = 'SELECT * FROM usage_records WHERE 1=1';
    const params: any[] = [];
    if (startDate) { query += ' AND usage_date >= ?'; params.push(startDate); }
    if (endDate) { query += ' AND usage_date <= ?'; params.push(endDate); }
    if (source) { query += ' AND source = ?'; params.push(source); }
    query += ' ORDER BY usage_date DESC LIMIT ?';
    params.push(limit);

    const rows = this.sqlite.prepare(query).all(...params) as any[];
    return rows.map(r => ({
      id: r.id,
      source: r.source as Source,
      model: r.model,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      cacheReadTokens: r.cache_read_tokens,
      totalTokens: r.total_tokens,
      costUSD: r.cost_usd,
      sessionId: r.session_id,
      usageDate: r.usage_date,
      recordedAt: r.recorded_at,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));
  }

  // --- Account operations ---

  getAccounts(source?: Source): any[] {
    let query = 'SELECT * FROM accounts WHERE 1=1';
    const params: any[] = [];
    if (source) { query += ' AND source = ?'; params.push(source); }
    return this.sqlite.prepare(query).all(...params) as any[];
  }

  upsertAccount(account: { id: string; source: Source; name: string; isActive: boolean; config?: Record<string, unknown> }): void {
    this.sqlite.prepare(`
      INSERT OR REPLACE INTO accounts (id, source, name, is_active, config, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      account.id, account.source, account.name, account.isActive ? 1 : 0,
      account.config ? JSON.stringify(account.config) : null,
      new Date().toISOString()
    );
  }

  setActiveAccount(id: string): void {
    // Get source of the account being activated
    const account = this.sqlite.prepare('SELECT source FROM accounts WHERE id = ?').get(id) as any;
    if (!account) throw new Error(`Account ${id} not found`);

    const tx = this.sqlite.transaction(() => {
      this.sqlite.prepare('UPDATE accounts SET is_active = 0 WHERE source = ?').run(account.source);
      this.sqlite.prepare('UPDATE accounts SET is_active = 1 WHERE id = ?').run(id);
    });
    tx();
  }

  deleteAccount(id: string): void {
    this.sqlite.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  }

  close(): void {
    this.sqlite.close();
  }
}
