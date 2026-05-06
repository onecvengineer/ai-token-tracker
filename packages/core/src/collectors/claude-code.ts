import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ICollector, CollectorResult, UsageRecord, DailyUsage, Source } from './types.js';

interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
}

interface DailyModelToken {
  date: string;
  tokensByModel: Record<string, number>;
}

interface DailyActivity {
  date: string;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}

interface StatsCache {
  version: number;
  lastComputedDate: string;
  modelUsage: Record<string, ModelUsage>;
  dailyModelTokens: DailyModelToken[];
  dailyActivity: DailyActivity[];
  totalSessions: number;
  totalMessages: number;
}

interface ClaudeJsonlEntry {
  type?: string;
  timestamp?: string;
  uuid?: string;
  sessionId?: string;
  message?: {
    id?: string;
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

interface TokenBreakdown {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

function normalizeModel(model: string): string {
  return model.trim().toLowerCase();
}

function allocateByRatio(totalTokens: number, usage?: ModelUsage): TokenBreakdown {
  if (!usage || totalTokens <= 0) {
    return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  }

  const parts = [
    { key: 'inputTokens' as const, value: usage.inputTokens },
    { key: 'outputTokens' as const, value: usage.outputTokens },
    { key: 'cacheReadTokens' as const, value: usage.cacheReadInputTokens },
  ];
  const aggregateTotal = parts.reduce((sum, part) => sum + part.value, 0);
  if (aggregateTotal <= 0) {
    return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  }

  const raw = parts.map((part) => {
    const scaled = totalTokens * (part.value / aggregateTotal);
    return {
      key: part.key,
      integer: Math.floor(scaled),
      fraction: scaled - Math.floor(scaled),
    };
  });

  let assigned = raw.reduce((sum, part) => sum + part.integer, 0);
  const result: TokenBreakdown = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };

  for (const part of raw) {
    result[part.key] = part.integer;
  }

  raw
    .sort((a, b) => b.fraction - a.fraction)
    .slice(0, Math.max(0, totalTokens - assigned))
    .forEach((part) => {
      result[part.key] += 1;
      assigned += 1;
    });

  return result;
}

function dailyUsageToRecord(entry: DailyUsage): UsageRecord {
  return {
    id: `claude-code-${entry.date}-${normalizeModel(entry.model)}`,
    source: 'claude-code',
    model: normalizeModel(entry.model),
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    cacheReadTokens: entry.cacheReadTokens,
    totalTokens: entry.totalTokens,
    costUSD: entry.costUSD,
    sessionId: `stats-cache:${entry.date}`,
    usageDate: entry.date,
    recordedAt: new Date().toISOString(),
    metadata: {
      aggregated: true,
      provider: 'stats-cache',
      messageCount: entry.messageCount,
      sessionCount: entry.sessionCount,
      toolCallCount: entry.toolCallCount,
    },
  };
}

export class ClaudeCodeCollector implements ICollector {
  readonly source: Source = 'claude-code';
  private readonly claudeDir: string;
  private readonly statsPath: string;
  private readonly projectsDir: string;

  constructor(claudeDir?: string) {
    this.claudeDir = claudeDir ?? join(homedir(), '.claude');
    this.statsPath = join(this.claudeDir, 'stats-cache.json');
    this.projectsDir = join(this.claudeDir, 'projects');
  }

  async isAvailable(): Promise<boolean> {
    return existsSync(this.statsPath) || existsSync(this.projectsDir);
  }

  async collect(): Promise<CollectorResult> {
    const jsonlData = await this.collectFromProjectLogs();
    if (jsonlData.records.length > 0) {
      return jsonlData;
    }

    return this.collectFromStatsCache();
  }

  private async listProjectLogFiles(dir: string): Promise<string[]> {
    if (!existsSync(dir)) return [];

    const files: string[] = [];
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await this.listProjectLogFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }
    return files;
  }

  private async collectFromProjectLogs(): Promise<CollectorResult> {
    const files = await this.listProjectLogFiles(this.projectsDir);
    const seenMessageIds = new Set<string>();
    const records: UsageRecord[] = [];
    const dailyMap = new Map<string, DailyUsage>();
    const sessionsByDailyKey = new Map<string, Set<string>>();

    for (const file of files) {
      let raw: string;
      try {
        raw = await readFile(file, 'utf-8');
      } catch {
        continue;
      }

      for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) continue;

        let entry: ClaudeJsonlEntry;
        try {
          entry = JSON.parse(line) as ClaudeJsonlEntry;
        } catch {
          continue;
        }

        const usage = entry.message?.usage;
        const messageId = entry.message?.id || entry.uuid;
        const timestamp = entry.timestamp;
        if (entry.type !== 'assistant' || !usage || !messageId || !timestamp || seenMessageIds.has(messageId)) {
          continue;
        }
        seenMessageIds.add(messageId);

        const inputTokens = usage.input_tokens ?? 0;
        const outputTokens = usage.output_tokens ?? 0;
        const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
        const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;
        const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;
        if (totalTokens === 0) continue;

        const model = normalizeModel(entry.message?.model || 'unknown');
        const date = timestamp.split('T')[0];
        const recordedAt = new Date(timestamp).toISOString();
        const sessionId = entry.sessionId || 'unknown';

        records.push({
          id: `claude-code-jsonl-${messageId}`,
          source: 'claude-code',
          model,
          inputTokens: inputTokens + cacheCreationTokens,
          outputTokens,
          cacheReadTokens,
          totalTokens,
          costUSD: null,
          sessionId,
          usageDate: date,
          recordedAt,
          metadata: {
            provider: 'project-log',
            messageId,
            cacheCreationInputTokens: cacheCreationTokens,
          },
        });

        const key = `${date}-${model}`;
        const sessions = sessionsByDailyKey.get(key) ?? new Set<string>();
        sessions.add(sessionId);
        sessionsByDailyKey.set(key, sessions);

        const existing = dailyMap.get(key);
        if (existing) {
          existing.inputTokens += inputTokens + cacheCreationTokens;
          existing.outputTokens += outputTokens;
          existing.cacheReadTokens += cacheReadTokens;
          existing.totalTokens += totalTokens;
          existing.messageCount += 1;
        } else {
          dailyMap.set(key, {
            date,
            source: 'claude-code',
            model,
            inputTokens: inputTokens + cacheCreationTokens,
            outputTokens,
            cacheReadTokens,
            totalTokens,
            costUSD: null,
            messageCount: 1,
            sessionCount: 1,
            toolCallCount: 0,
          });
        }
      }
    }

    for (const [key, sessions] of sessionsByDailyKey) {
      const daily = dailyMap.get(key);
      if (daily) daily.sessionCount = sessions.size;
    }

    return { records, dailyUsage: Array.from(dailyMap.values()) };
  }

  private async collectFromStatsCache(): Promise<CollectorResult> {
    if (!existsSync(this.statsPath)) {
      return { records: [], dailyUsage: [] };
    }

    const raw = await readFile(this.statsPath, 'utf-8');
    const stats: StatsCache = JSON.parse(raw);

    const records: UsageRecord[] = [];
    const dailyUsage: DailyUsage[] = [];

    const modelUsageByName = new Map<string, ModelUsage>();
    for (const [model, usage] of Object.entries(stats.modelUsage)) {
      modelUsageByName.set(normalizeModel(model), usage);
    }

    const activityByDate = new Map<string, DailyActivity>();
    for (const act of stats.dailyActivity) {
      activityByDate.set(act.date, act);
    }

    for (const dmt of stats.dailyModelTokens) {
      const activity = activityByDate.get(dmt.date);
      for (const [model, totalTokens] of Object.entries(dmt.tokensByModel)) {
        const normalizedModel = normalizeModel(model);
        const modelUsage = modelUsageByName.get(normalizedModel);
        const breakdown = allocateByRatio(totalTokens, modelUsage);

        const dailyEntry: DailyUsage = {
          date: dmt.date,
          source: 'claude-code',
          model: normalizedModel,
          inputTokens: breakdown.inputTokens,
          outputTokens: breakdown.outputTokens,
          cacheReadTokens: breakdown.cacheReadTokens,
          totalTokens,
          costUSD: modelUsage?.costUSD || null,
          messageCount: activity?.messageCount ?? 0,
          sessionCount: activity?.sessionCount ?? 0,
          toolCallCount: activity?.toolCallCount ?? 0,
        };

        dailyUsage.push(dailyEntry);
        records.push(dailyUsageToRecord(dailyEntry));
      }
    }

    return { records, dailyUsage };
  }
}
