import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { ClaudeCodeCollector, CodexCollector, HermesCollector, Repository, getAllBalances, ClaudeCodeConfig, CodexConfig } from '@att/core';
import type { Source } from '@att/core';

const app = new Hono();

// Middleware
app.use('*', cors());

// Initialize repository
const repo = new Repository();

// Collectors
const collectors = {
  'claude-code': new ClaudeCodeCollector(),
  'codex': new CodexCollector(),
  'hermes': new HermesCollector(),
};

// ========== Sync ==========

app.post('/api/sync', async (c) => {
  const results: Record<string, { success: boolean; records: number; error?: string }> = {};

  for (const [source, collector] of Object.entries(collectors)) {
    try {
      const available = await collector.isAvailable();
      if (!available) {
        results[source] = { success: false, records: 0, error: 'Not available' };
        continue;
      }
      const data = await collector.collect();
      repo.upsertRecords(data.records);
      repo.upsertDailyUsage(data.dailyUsage);
      repo.updateSyncState(source as Source, data.records.length);
      results[source] = { success: true, records: data.records.length };
    } catch (err: any) {
      results[source] = { success: false, records: 0, error: err.message };
    }
  }

  return c.json({ synced: results });
});

// ========== Usage ==========

app.get('/api/usage/summary', (c) => {
  const start = c.req.query('start');
  const end = c.req.query('end');
  const preset = c.req.query('preset');

  let startDate = start;
  let endDate = end;

  if (preset) {
    const now = new Date();
    endDate = now.toISOString().split('T')[0];
    switch (preset) {
      case 'today':
        startDate = endDate;
        break;
      case '7d':
        startDate = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0];
        break;
      case 'this_month':
        startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        break;
      case 'last_month': {
        const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        startDate = `${lm.getFullYear()}-${String(lm.getMonth() + 1).padStart(2, '0')}-01`;
        const lmEnd = new Date(now.getFullYear(), now.getMonth(), 0);
        endDate = `${lmEnd.getFullYear()}-${String(lmEnd.getMonth() + 1).padStart(2, '0')}-${String(lmEnd.getDate()).padStart(2, '0')}`;
        break;
      }
    }
  }

  const summary = repo.getUsageSummary(startDate, endDate);
  return c.json(summary);
});

app.get('/api/usage/daily', (c) => {
  const start = c.req.query('start');
  const end = c.req.query('end');
  const source = c.req.query('source') as Source | undefined;
  return c.json(repo.getDailyUsage(start, end, source));
});

app.get('/api/usage/by-model', (c) => {
  const summary = repo.getUsageSummary(c.req.query('start'), c.req.query('end'));
  return c.json(summary.byModel);
});

app.get('/api/usage/by-source', (c) => {
  const summary = repo.getUsageSummary(c.req.query('start'), c.req.query('end'));
  return c.json(summary.bySource);
});

app.get('/api/usage/records', (c) => {
  const start = c.req.query('start');
  const end = c.req.query('end');
  const source = c.req.query('source') as Source | undefined;
  const limit = parseInt(c.req.query('limit') || '100');
  return c.json(repo.getRecords(start, end, source, limit));
});

app.get('/api/usage/export', (c) => {
  const format = c.req.query('format') || 'json';
  const records = repo.getRecords(c.req.query('start'), c.req.query('end'), undefined, 10000);

  if (format === 'csv') {
    const header = 'id,source,model,inputTokens,outputTokens,cacheReadTokens,totalTokens,costUSD,sessionId,usageDate\n';
    const rows = records.map(r =>
      `${r.id},${r.source},${r.model},${r.inputTokens},${r.outputTokens},${r.cacheReadTokens},${r.totalTokens},${r.costUSD},${r.sessionId},${r.usageDate}`
    ).join('\n');
    return c.text(header + rows, 200, {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename=usage-export.csv',
    });
  }

  return c.json(records);
});

// ========== Accounts & Balance ==========

app.get('/api/accounts/balance', async (c) => {
  const balances = await getAllBalances();
  return c.json(balances);
});

// ========== Config ==========

app.get('/api/config/claude/models', async (c) => {
  const config = new ClaudeCodeConfig();
  const models = await config.listModels();
  return c.json(models);
});

app.post('/api/config/claude/set-model', async (c) => {
  const body = await c.req.json<{ model: string; tier?: 'sonnet' | 'opus' | 'haiku' }>();
  const config = new ClaudeCodeConfig();
  if (body.tier) {
    await config.setCustomModel(body.model, body.tier);
  } else {
    await config.setModel(body.model);
  }
  return c.json({ success: true });
});

app.get('/api/config/codex/accounts', async (c) => {
  const config = new CodexConfig();
  const accounts = await config.listAccounts();
  return c.json(accounts);
});

app.post('/api/config/codex/accounts/add', async (c) => {
  const body = await c.req.json<{ name: string; config: Record<string, unknown> }>();
  const codexConfig = new CodexConfig();
  await codexConfig.addAccount(body.name, body.config);
  return c.json({ success: true });
});

app.post('/api/config/codex/accounts/switch', async (c) => {
  const body = await c.req.json<{ name: string }>();
  const config = new CodexConfig();
  await config.switchAccount(body.name);
  return c.json({ success: true });
});

app.delete('/api/config/codex/accounts/:name', async (c) => {
  const config = new CodexConfig();
  await config.removeAccount(c.req.param('name'));
  return c.json({ success: true });
});

// ========== Sync State ==========

app.get('/api/sync/state', (c) => {
  const states: Record<string, any> = {};
  for (const source of ['claude-code', 'codex', 'hermes'] as Source[]) {
    states[source] = repo.getSyncState(source);
  }
  return c.json(states);
});

// ========== Start server ==========

const PORT = parseInt(process.env.ATT_PORT || '3456');

export function startServer() {
  return serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`ATT API Server running at http://localhost:${info.port}`);
  });
}

export { app };

// Auto-start if called directly
if (process.argv[1]?.endsWith('api/dist/index.js')) {
  startServer();
}
