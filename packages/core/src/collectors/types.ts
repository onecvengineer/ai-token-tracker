export type Source = 'claude-code' | 'codex' | 'hermes';

export interface UsageRecord {
  id: string;
  source: Source;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  costUSD: number | null;
  sessionId: string;
  usageDate: string;    // ISO date string YYYY-MM-DD
  recordedAt: string;   // ISO datetime
  metadata?: Record<string, unknown>;
}

export interface DailyUsage {
  date: string;
  source: Source;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  costUSD: number | null;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalTokens: number;
  totalCostUSD: number;
  totalSessions: number;
  totalMessages: number;
  bySource: Record<Source, {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    totalTokens: number;
    costUSD: number;
  }>;
  byModel: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    totalTokens: number;
    costUSD: number;
  }>;
}

export interface CollectorResult {
  records: UsageRecord[];
  dailyUsage: DailyUsage[];
}

export interface ICollector {
  readonly source: Source;
  collect(): Promise<CollectorResult>;
  isAvailable(): Promise<boolean>;
}

export interface AccountInfo {
  id: string;
  source: Source;
  name: string;
  isActive: boolean;
  balance?: number | null;
  balanceUnit?: string;
  metadata?: Record<string, unknown>;
}

export interface ModelOption {
  id: string;
  name: string;
  source: Source;
  isCurrent: boolean;
}
