import { readFile } from 'node:fs/promises';
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

// Zhipu API response types
interface ZhipuModelUsageResponse {
  success: boolean;
  data: {
    x_time: string[];
    modelDataList: {
      modelName: string;
      tokensUsage: number[];
      totalTokens: number;
    }[];
    totalUsage: {
      totalModelCallCount: number;
      totalTokensUsage: number;
      modelSummaryList: { modelName: string; totalTokens: number }[];
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

function scaleBreakdownToTotal(
  breakdown: TokenBreakdown,
  targetTotal: number,
): TokenBreakdown {
  const currentTotal = breakdown.inputTokens + breakdown.outputTokens + breakdown.cacheReadTokens;
  if (currentTotal <= 0 || targetTotal <= 0) {
    return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  }

  return allocateByRatio(targetTotal, {
    inputTokens: breakdown.inputTokens,
    outputTokens: breakdown.outputTokens,
    cacheReadInputTokens: breakdown.cacheReadTokens,
    cacheCreationInputTokens: 0,
    costUSD: 0,
  });
}

function mergeDailyUsage(existing: DailyUsage | undefined, incoming: DailyUsage): DailyUsage {
  if (!existing) return incoming;

  const incomingHasBreakdown = incoming.inputTokens + incoming.outputTokens + incoming.cacheReadTokens > 0;
  const existingHasBreakdown = existing.inputTokens + existing.outputTokens + existing.cacheReadTokens > 0;
  const totalTokens = incoming.totalTokens > 0 ? incoming.totalTokens : existing.totalTokens;

  let breakdown: TokenBreakdown;
  if (incomingHasBreakdown) {
    breakdown = {
      inputTokens: incoming.inputTokens,
      outputTokens: incoming.outputTokens,
      cacheReadTokens: incoming.cacheReadTokens,
    };
  } else if (existingHasBreakdown) {
    breakdown = scaleBreakdownToTotal({
      inputTokens: existing.inputTokens,
      outputTokens: existing.outputTokens,
      cacheReadTokens: existing.cacheReadTokens,
    }, totalTokens);
  } else {
    breakdown = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  }

  return {
    ...existing,
    ...incoming,
    inputTokens: breakdown.inputTokens,
    outputTokens: breakdown.outputTokens,
    cacheReadTokens: breakdown.cacheReadTokens,
    totalTokens,
    costUSD: incoming.costUSD ?? existing.costUSD,
    messageCount: Math.max(existing.messageCount, incoming.messageCount),
    sessionCount: Math.max(existing.sessionCount, incoming.sessionCount),
    toolCallCount: Math.max(existing.toolCallCount, incoming.toolCallCount),
  };
}

function dailyUsageToRecord(entry: DailyUsage, provider: 'stats-cache' | 'zhipu' | 'merged'): UsageRecord {
  return {
    id: `claude-code-${entry.date}-${normalizeModel(entry.model)}`,
    source: 'claude-code',
    model: normalizeModel(entry.model),
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    cacheReadTokens: entry.cacheReadTokens,
    totalTokens: entry.totalTokens,
    costUSD: entry.costUSD,
    sessionId: `${provider}:${entry.date}`,
    usageDate: entry.date,
    recordedAt: new Date().toISOString(),
    metadata: {
      aggregated: true,
      provider,
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
  private readonly settingsPath: string;

  constructor(claudeDir?: string) {
    this.claudeDir = claudeDir ?? join(homedir(), '.claude');
    this.statsPath = join(this.claudeDir, 'stats-cache.json');
    this.settingsPath = join(this.claudeDir, 'settings.json');
  }

  async isAvailable(): Promise<boolean> {
    // Available if either stats-cache.json exists or Zhipu API is configured
    return existsSync(this.statsPath) || (await this.getZhipuConfig()) !== null;
  }

  async collect(): Promise<CollectorResult> {
    const results = await Promise.allSettled([
      this.collectFromStatsCache(),
      this.collectFromZhipuAPI(),
    ]);

    const dailyMap = new Map<string, DailyUsage>();

    // Merge stats-cache data
    if (results[0].status === 'fulfilled' && results[0].value) {
      const r = results[0].value;
      for (const d of r.dailyUsage) {
        const key = `${d.date}-${normalizeModel(d.model)}`;
        dailyMap.set(key, mergeDailyUsage(dailyMap.get(key), d));
      }
    }

    // Merge Zhipu API data (overrides stats-cache for overlapping dates since it's more accurate)
    if (results[1].status === 'fulfilled' && results[1].value) {
      const r = results[1].value;
      for (const d of r.dailyUsage) {
        const key = `${d.date}-${normalizeModel(d.model)}`;
        dailyMap.set(key, mergeDailyUsage(dailyMap.get(key), d));
      }
    }

    const dailyUsage = Array.from(dailyMap.values());
    const hasStatsCache = results[0].status === 'fulfilled' && !!results[0].value;
    const hasZhipu = results[1].status === 'fulfilled' && !!results[1].value;
    const provider = hasStatsCache && hasZhipu ? 'merged' : hasZhipu ? 'zhipu' : 'stats-cache';

    return {
      records: dailyUsage.map((entry) => dailyUsageToRecord(entry, provider)),
      dailyUsage,
    };
  }

  private async collectFromStatsCache(): Promise<CollectorResult | null> {
    if (!existsSync(this.statsPath)) return null;

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
        records.push(dailyUsageToRecord(dailyEntry, 'stats-cache'));
      }
    }

    return { records, dailyUsage };
  }

  private async getZhipuConfig(): Promise<{ baseUrl: string; authToken: string } | null> {
    if (!existsSync(this.settingsPath)) return null;
    try {
      const settings = JSON.parse(await readFile(this.settingsPath, 'utf-8'));
      const baseUrl = settings.env?.ANTHROPIC_BASE_URL || '';
      const authToken = settings.env?.ANTHROPIC_AUTH_TOKEN || settings.env?.ANTHROPIC_API_KEY || '';
      if (authToken && (baseUrl.includes('bigmodel.cn') || baseUrl.includes('z.ai'))) {
        return { baseUrl, authToken };
      }
    } catch {}
    return null;
  }

  private async collectFromZhipuAPI(): Promise<CollectorResult | null> {
    const config = await this.getZhipuConfig();
    if (!config) return null;

    // Query last 30 days of data (API seems to support up to ~48 hours in one call,
    // so we make multiple calls to cover the range)
    const records: UsageRecord[] = [];
    const dailyMap = new Map<string, DailyUsage>();

    const now = new Date();

    // Query in 2-day chunks to stay within API limits
    for (let daysAgo = 0; daysAgo < 30; daysAgo += 2) {
      const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, now.getHours(), 59, 59, 999);
      const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo - 2, now.getHours(), 0, 0, 0);

      try {
        const data = await this.queryZhipuModelUsage(config, startDate, endDate);
        if (!data) continue;

        // Aggregate hourly data into daily per-model usage
        const dailyAgg = new Map<string, { tokens: number; calls: number }>();

        for (const modelData of data.modelDataList) {
          const normalizedModel = modelData.modelName.toLowerCase();
          for (let i = 0; i < data.x_time.length; i++) {
            const tokens = modelData.tokensUsage[i] || 0;
            if (tokens === 0) continue;

            const date = data.x_time[i].split(' ')[0]; // "2026-04-17 10:00" → "2026-04-17"
            const key = `${date}|${normalizedModel}`;
            const existing = dailyAgg.get(key);
            if (existing) {
              existing.tokens += tokens;
              existing.calls += 1;
            } else {
              dailyAgg.set(key, { tokens, calls: 1 });
            }
          }
        }

        for (const [key, agg] of dailyAgg) {
          const [date, model] = key.split('|');
          const duKey = `${date}-${model}`;
          const dailyEntry: DailyUsage = {
            date,
            source: 'claude-code',
            model,
            inputTokens: 0, // Zhipu API only gives total tokens
            outputTokens: 0,
            cacheReadTokens: 0,
            totalTokens: agg.tokens,
            costUSD: null,
            messageCount: 0,
            sessionCount: 0,
            toolCallCount: agg.calls,
          };

          records.push(dailyUsageToRecord(dailyEntry, 'zhipu'));
          dailyMap.set(duKey, dailyEntry);
        }
      } catch {
        // Skip failed chunks
      }
    }

    return { records, dailyUsage: Array.from(dailyMap.values()) };
  }

  private async queryZhipuModelUsage(
    config: { baseUrl: string; authToken: string },
    startDate: Date,
    endDate: Date,
  ): Promise<ZhipuModelUsageResponse['data'] | null> {
    const parsedUrl = new URL(config.baseUrl);
    const baseDomain = `${parsedUrl.protocol}//${parsedUrl.host}`;

    const fmt = (d: Date) => {
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };

    const url = `${baseDomain}/api/monitor/usage/model-usage?startTime=${encodeURIComponent(fmt(startDate))}&endTime=${encodeURIComponent(fmt(endDate))}`;

    const resp = await fetch(url, {
      headers: {
        Authorization: config.authToken,
        'Accept-Language': 'en-US,en',
        'Content-Type': 'application/json',
      },
    });

    if (!resp.ok) return null;
    const json = await resp.json() as ZhipuModelUsageResponse;
    return json.success ? json.data : null;
  }
}
