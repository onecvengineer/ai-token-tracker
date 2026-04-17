import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const usageRecords = sqliteTable('usage_records', {
  id: text('id').primaryKey(),
  source: text('source', { enum: ['claude-code', 'codex', 'hermes'] }).notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  totalTokens: integer('total_tokens').notNull().default(0),
  costUSD: real('cost_usd'),
  sessionId: text('session_id').notNull(),
  usageDate: text('usage_date').notNull(),
  recordedAt: text('recorded_at').notNull(),
  metadata: text('metadata'), // JSON string
});

export const dailyUsage = sqliteTable('daily_usage', {
  id: text('id').primaryKey(), // date-source-model
  date: text('date').notNull(),
  source: text('source', { enum: ['claude-code', 'codex', 'hermes'] }).notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  totalTokens: integer('total_tokens').notNull().default(0),
  costUSD: real('cost_usd'),
  messageCount: integer('message_count').notNull().default(0),
  sessionCount: integer('session_count').notNull().default(0),
  toolCallCount: integer('tool_call_count').notNull().default(0),
});

export const syncState = sqliteTable('sync_state', {
  source: text('source', { enum: ['claude-code', 'codex', 'hermes'] }).primaryKey(),
  lastSyncAt: text('last_sync_at').notNull(),
  recordCount: integer('record_count').notNull().default(0),
});

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  source: text('source', { enum: ['claude-code', 'codex', 'hermes'] }).notNull(),
  name: text('name').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
  config: text('config'), // JSON string
  createdAt: text('created_at').notNull(),
});
