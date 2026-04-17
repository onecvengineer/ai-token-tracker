#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import ora from 'ora';
import { ClaudeCodeCollector, CodexCollector, HermesCollector, Repository, getAllBalances, fetchCodexRateLimits, ClaudeCodeConfig, CodexConfig } from '@att/core';
import type { Source } from '@att/core';

const program = new Command();

program
  .name('att')
  .description('AI Token Tracker - Track Claude Code, Codex, and Hermes token usage')
  .version('0.1.0');

// ========== sync command ==========

program
  .command('sync')
  .description('Sync token usage data from all sources')
  .action(async () => {
    let spinner = ora('Syncing token usage data...').start();
    const repo = new Repository();
    const collectors = {
      'claude-code': new ClaudeCodeCollector(),
      'codex': new CodexCollector(),
      'hermes': new HermesCollector(),
    };

    for (const [source, collector] of Object.entries(collectors)) {
      try {
        const available = await collector.isAvailable();
        if (!available) {
          spinner.text = `${source}: not available, skipping`;
          continue;
        }
        spinner.text = `Syncing ${source}...`;
        const data = await collector.collect();
        repo.upsertRecords(data.records);
        repo.upsertDailyUsage(data.dailyUsage);
        repo.updateSyncState(source as Source, data.records.length);
        spinner.succeed(`${source}: ${data.records.length} records synced`);
        spinner = ora();
      } catch (err: any) {
        spinner.warn(`${source}: ${err.message}`);
        spinner = ora();
      }
    }

    spinner.stop();
    repo.close();
    console.log(chalk.green('\nSync complete!'));
  });

// ========== usage command ==========

const usageCmd = program.command('usage').description('View token usage statistics');

usageCmd
  .command('show')
  .description('Show usage summary')
  .option('-s, --start <date>', 'Start date (YYYY-MM-DD)')
  .option('-e, --end <date>', 'End date (YYYY-MM-DD)')
  .option('-p, --preset <preset>', 'Preset: today, 7d, 30d, this_month, last_month')
  .option('--source <source>', 'Filter by source: claude-code, codex, hermes')
  .action(async (opts) => {
    const repo = new Repository();
    let start = opts.start;
    let end = opts.end;

    if (opts.preset) {
      const now = new Date();
      end = now.toISOString().split('T')[0];
      switch (opts.preset) {
        case 'today': start = end; break;
        case '7d': start = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0]; break;
        case '30d': start = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0]; break;
        case 'this_month': start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`; break;
      }
    }

    const summary = repo.getUsageSummary(start, end);
    repo.close();

    console.log(chalk.bold('\n=== Token Usage Summary ===\n'));
    if (start || end) {
      console.log(chalk.gray(`Period: ${start || 'beginning'} ~ ${end || 'now'}\n`));
    }

    // By source table
    const sourceTable = new Table({
      head: ['Source', 'Input Tokens', 'Output Tokens', 'Cache Read', 'Total Tokens'],
      style: { head: ['cyan'] },
    });

    for (const [source, data] of Object.entries(summary.bySource)) {
      sourceTable.push([
        source,
        formatNumber(data.inputTokens),
        formatNumber(data.outputTokens),
        formatNumber(data.totalTokens - data.inputTokens - data.outputTokens),
        formatNumber(data.totalTokens),
      ]);
    }

    sourceTable.push([
      chalk.bold('TOTAL'),
      chalk.bold(formatNumber(summary.totalInputTokens)),
      chalk.bold(formatNumber(summary.totalOutputTokens)),
      chalk.bold(formatNumber(summary.totalCacheReadTokens)),
      chalk.bold(formatNumber(summary.totalTokens)),
    ]);

    console.log(sourceTable.toString());

    // By model table
    if (Object.keys(summary.byModel).length > 0) {
      const modelTable = new Table({
        head: ['Model', 'Input Tokens', 'Output Tokens', 'Total Tokens'],
        style: { head: ['cyan'] },
      });

      for (const [model, data] of Object.entries(summary.byModel)) {
        modelTable.push([
          model,
          formatNumber(data.inputTokens),
          formatNumber(data.outputTokens),
          formatNumber(data.totalTokens),
        ]);
      }

      console.log('\n' + modelTable.toString());
    }
  });

usageCmd
  .command('daily')
  .description('Show daily usage breakdown')
  .option('-s, --start <date>', 'Start date')
  .option('-e, --end <date>', 'End date')
  .option('-p, --preset <preset>', 'Preset: 7d, 30d')
  .action(async (opts) => {
    const repo = new Repository();
    let start = opts.start;
    let end = opts.end;

    if (opts.preset) {
      const now = new Date();
      end = now.toISOString().split('T')[0];
      if (opts.preset === '7d') start = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];
      if (opts.preset === '30d') start = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0];
    }

    const daily = repo.getDailyUsage(start, end, opts.source);
    repo.close();

    const table = new Table({
      head: ['Date', 'Source', 'Model', 'Total Tokens', 'Sessions', 'Messages', 'Tool Calls'],
      style: { head: ['cyan'] },
    });

    for (const d of daily) {
      table.push([
        d.date,
        d.source,
        d.model,
        formatNumber(d.totalTokens),
        d.sessionCount,
        d.messageCount,
        d.toolCallCount,
      ]);
    }

    console.log(table.toString());
  });

usageCmd
  .command('export')
  .description('Export usage data')
  .option('-f, --format <format>', 'Export format: json, csv', 'json')
  .option('-s, --start <date>', 'Start date')
  .option('-e, --end <date>', 'End date')
  .action(async (opts) => {
    const repo = new Repository();
    const records = repo.getRecords(opts.start, opts.end, undefined, 10000);
    repo.close();

    if (opts.format === 'csv') {
      console.log('id,source,model,inputTokens,outputTokens,cacheReadTokens,totalTokens,costUSD,sessionId,usageDate');
      for (const r of records) {
        console.log(`${r.id},${r.source},${r.model},${r.inputTokens},${r.outputTokens},${r.cacheReadTokens},${r.totalTokens},${r.costUSD},${r.sessionId},${r.usageDate}`);
      }
    } else {
      console.log(JSON.stringify(records, null, 2));
    }
  });

// ========== config command ==========

const configCmd = program.command('config').description('Manage tool configurations');

// Claude Code config
const claudeCmd = configCmd.command('claude').description('Claude Code model configuration');

claudeCmd
  .command('list-models')
  .description('List available models')
  .action(async () => {
    const config = new ClaudeCodeConfig();
    const models = await config.listModels();
    const table = new Table({ head: ['ID', 'Name', 'Active'], style: { head: ['cyan'] } });
    for (const m of models) {
      table.push([m.id, m.name, m.isCurrent ? chalk.green('Yes') : 'No']);
    }
    console.log(table.toString());
  });

claudeCmd
  .command('set-model <model>')
  .description('Set model (use known ID like sonnet/opus/haiku or custom model name)')
  .option('-t, --tier <tier>', 'Tier for custom model: sonnet, opus, haiku', 'sonnet')
  .action(async (model, opts) => {
    const config = new ClaudeCodeConfig();
    if (['sonnet', 'opus', 'haiku'].includes(model)) {
      await config.setModel(model);
      console.log(chalk.green(`Reset ${model} tier to default`));
    } else {
      await config.setCustomModel(model, opts.tier);
      console.log(chalk.green(`Set custom model "${model}" for ${opts.tier} tier`));
    }
  });

// Codex config
const codexCmd = configCmd.command('codex').description('Codex configuration');

const accountsCmd = codexCmd.command('accounts').description('Manage Codex accounts');

accountsCmd
  .command('list')
  .description('List all accounts')
  .action(async () => {
    const config = new CodexConfig();
    const accounts = await config.listAccounts();
    if (config.newAccountDetected) {
      console.log(chalk.yellow(`Auto-detected new account: "${config.newAccountDetected}"`));
      console.log(chalk.gray(`Use "att config codex accounts rename" to change the name.\n`));
    }

    // Fetch rate limits for each account (sequential to avoid proxy contention)
    const { readFile } = await import('node:fs/promises');
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { homedir } = await import('node:os');
    const accountsPath = join(homedir(), '.codex', 'accounts.json');

    let accountsData: any = null;
    if (existsSync(accountsPath)) {
      try { accountsData = JSON.parse(await readFile(accountsPath, 'utf-8')); } catch {}
    }

    const rlResults: (typeof accounts[number] extends any ? Awaited<ReturnType<typeof fetchCodexRateLimits>> : never)[] = [];
    for (const a of accounts) {
      if (!accountsData?.accounts?.[a.id]) { rlResults.push(undefined); continue; }
      const auth = accountsData.accounts[a.id];
      const accessToken = auth.tokens?.access_token || auth.access_token;
      const idToken = auth.tokens?.id_token || auth.id_token;
      let result;
      for (let attempt = 0; attempt < 2; attempt++) {
        result = await fetchCodexRateLimits(accessToken, idToken);
        if (result) break;
        if (attempt === 0) await new Promise(r => setTimeout(r, 500));
      }
      rlResults.push(result);
    }

    const table = new Table({ head: ['Name', 'Email', 'Plan', 'Rate Limit', 'Status'], style: { head: ['cyan'] } });
    for (let i = 0; i < accounts.length; i++) {
      const a = accounts[i];
      table.push([
        a.name,
        a.email,
        a.planType !== '-' ? chalk.cyan(a.planType) : '-',
        formatRateLimit(rlResults[i]),
        a.isActive ? chalk.green('* Active') : '',
      ]);
    }
    console.log(table.toString());
  });

accountsCmd
  .command('add <name>')
  .description('Add a new account')
  .requiredOption('--access-token <token>', 'Access token')
  .option('--id-token <token>', 'ID token')
  .option('--refresh-token <token>', 'Refresh token')
  .option('--account-id <id>', 'Account ID')
  .action(async (name, opts) => {
    const config = new CodexConfig();
    await config.addAccount(name, {
      auth_mode: 'chatgpt',
      access_token: opts.accessToken,
      id_token: opts.idToken,
      refresh_token: opts.refreshToken,
      account_id: opts.accountId,
    });
    console.log(chalk.green(`Account "${name}" added`));
  });

accountsCmd
  .command('switch <name>')
  .description('Switch to account')
  .action(async (name) => {
    const config = new CodexConfig();
    await config.switchAccount(name);
    console.log(chalk.green(`Switched to account "${name}"`));
  });

accountsCmd
  .command('remove <name>')
  .description('Remove an account')
  .action(async (name) => {
    const config = new CodexConfig();
    await config.removeAccount(name);
    console.log(chalk.green(`Account "${name}" removed`));
  });

accountsCmd
  .command('verify <name>')
  .description('Verify account validity')
  .action(async (name) => {
    const config = new CodexConfig();
    const valid = await config.verifyAccount(name);
    if (valid) {
      console.log(chalk.green(`Account "${name}" is valid`));
    } else {
      console.log(chalk.red(`Account "${name}" is invalid or not found`));
    }
  });

accountsCmd
  .command('rename <oldName> <newName>')
  .description('Rename an account')
  .action(async (oldName, newName) => {
    const config = new CodexConfig();
    await config.renameAccount(oldName, newName);
    console.log(chalk.green(`Account "${oldName}" renamed to "${newName}"`));
  });

// ========== accounts command ==========

program
  .command('balance')
  .description('Show account balances and rate limits')
  .action(async () => {
    const balances = await getAllBalances();
    const table = new Table({ head: ['Source', 'Account', 'Model', 'Rate Limit', 'Status'], style: { head: ['cyan'] } });
    for (const b of balances) {
      const rl = formatRateLimit(b.rateLimits);
      const planPrefix = b.rateLimits?.planType ? `Plan: ${b.rateLimits.planType}\n` : '';
      table.push([
        b.source,
        b.accountName,
        b.model !== '-' ? chalk.cyan(b.model) : '-',
        planPrefix ? planPrefix + rl : rl,
        b.status === 'active' ? chalk.green('Active') : b.status === 'inactive' ? chalk.gray('Inactive') : chalk.yellow('Unknown'),
      ]);
    }
    console.log(table.toString());
  });

// ========== serve command ==========

program
  .command('serve')
  .description('Start API server')
  .option('-p, --port <port>', 'Port number', '3456')
  .action(async (opts) => {
    process.env.ATT_PORT = opts.port;
    const { startServer } = await import('@att/api');
    startServer();
  });

// ========== Helper ==========

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function formatResetTime(seconds: number): string {
  const resetAt = new Date(Date.now() + seconds * 1000);
  const h = Math.floor(seconds / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  const timeStr = `${pad(resetAt.getHours())}:${pad(resetAt.getMinutes())}`;
  if (h < 24) return timeStr;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${d}d${rh}h` : `${d}d`;
}

function formatRateLimit(rl: { planType?: string | null; primaryUsedPercent?: number | null; primaryResetAfter?: number | null; secondaryUsedPercent?: number | null; secondaryResetAfter?: number | null } | undefined): string {
  if (!rl) return '-';
  const parts: string[] = [];
  if (rl.primaryUsedPercent != null) {
    const left = 100 - rl.primaryUsedPercent;
    const reset = rl.primaryResetAfter ? formatResetTime(rl.primaryResetAfter) : '';
    parts.push(`5h: ${left}%${reset ? ` (${reset})` : ''}`);
  }
  if (rl.secondaryUsedPercent != null) {
    const left = 100 - rl.secondaryUsedPercent;
    const reset = rl.secondaryResetAfter ? formatResetTime(rl.secondaryResetAfter) : '';
    parts.push(`7d: ${left}%${reset ? ` (${reset})` : ''}`);
  }
  return parts.length > 0 ? parts.join('\n') : '-';
}

program.parse();
