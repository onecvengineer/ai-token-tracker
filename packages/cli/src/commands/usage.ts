import { Command } from 'commander';
import Table from 'cli-table3';
import chalk from 'chalk';
import { Repository } from '@att/core';
import { formatNumber, printEmptyState, resolveCLIUsageQuery, withErrorHandling } from './shared.js';

function renderUsageSummary(opts: {
  start?: string;
  end?: string;
  preset?: string;
  source?: string;
}): void {
  const repo = new Repository();
  const query = resolveCLIUsageQuery(opts);
  const summary = repo.getUsageSummary(query.startDate, query.endDate, query.source);
  repo.close();

  console.log(chalk.bold('\n=== Token Usage Summary ===\n'));
  if (query.startDate || query.endDate) {
    console.log(chalk.gray(`Period: ${query.startDate || 'beginning'} ~ ${query.endDate || 'now'}\n`));
  }

  if (Object.keys(summary.bySource).length === 0) {
    printEmptyState('No usage data found for the selected filters.');
    return;
  }

  const sourceTable = new Table({
    head: ['Source', 'Input Tokens', 'Output Tokens', 'Cache Read', 'Total Tokens'],
    style: { head: ['cyan'] },
  });

  for (const [source, data] of Object.entries(summary.bySource)) {
    sourceTable.push([
      source,
      formatNumber(data.inputTokens),
      formatNumber(data.outputTokens),
      formatNumber(data.cacheReadTokens),
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

  const modelEntries = Object.entries(summary.byModel);
  if (modelEntries.length > 0) {
    const modelTable = new Table({
      head: ['Model', 'Input Tokens', 'Output Tokens', 'Total Tokens'],
      style: { head: ['cyan'] },
    });

    for (const [model, data] of modelEntries) {
      modelTable.push([
        model,
        formatNumber(data.inputTokens),
        formatNumber(data.outputTokens),
        formatNumber(data.totalTokens),
      ]);
    }

    console.log('\n' + modelTable.toString());
  }
}

function renderDailyUsage(opts: {
  start?: string;
  end?: string;
  preset?: string;
  source?: string;
}): void {
  const repo = new Repository();
  const query = resolveCLIUsageQuery(opts);
  const daily = repo.getDailyUsage(query.startDate, query.endDate, query.source);
  repo.close();

  if (daily.length === 0) {
    printEmptyState('No daily usage data found for the selected filters.');
    return;
  }

  const table = new Table({
    head: ['Date', 'Source', 'Model', 'Total Tokens', 'Sessions', 'Messages', 'Tool Calls'],
    style: { head: ['cyan'] },
  });

  for (const row of daily) {
    table.push([
      row.date,
      row.source,
      row.model,
      formatNumber(row.totalTokens),
      row.sessionCount,
      row.messageCount,
      row.toolCallCount,
    ]);
  }

  console.log(table.toString());
}

function exportUsage(opts: {
  format: string;
  start?: string;
  end?: string;
  preset?: string;
  source?: string;
}): void {
  const repo = new Repository();
  const query = resolveCLIUsageQuery(opts);
  const records = repo.getRecords(query.startDate, query.endDate, query.source, 10000);
  repo.close();

  if (opts.format === 'csv') {
    console.log('id,source,model,inputTokens,outputTokens,cacheReadTokens,totalTokens,costUSD,sessionId,usageDate');
    for (const record of records) {
      console.log(`${record.id},${record.source},${record.model},${record.inputTokens},${record.outputTokens},${record.cacheReadTokens},${record.totalTokens},${record.costUSD},${record.sessionId},${record.usageDate}`);
    }
    return;
  }

  console.log(JSON.stringify(records, null, 2));
}

export function registerUsageCommand(program: Command): void {
  const usageCmd = program
    .command('usage')
    .description('Show usage summary by default')
    .option('-s, --start <date>', 'Start date (YYYY-MM-DD)')
    .option('-e, --end <date>', 'End date (YYYY-MM-DD)')
    .option('-p, --preset <preset>', 'Preset: today, 7d, 30d, this_month, last_month')
    .option('--source <source>', 'Filter by source: claude-code, codex, hermes')
    .addHelpText('after', `
Examples:
  att usage
  att usage --preset 7d
  att usage --source codex --preset 30d
  att usage daily --preset 7d --source claude-code
  att usage export -f csv --preset 30d
`)
    .action(withErrorHandling(async (opts) => {
      renderUsageSummary(opts);
    }));

  usageCmd
    .command('daily')
    .description('Show daily usage breakdown')
    .option('-s, --start <date>', 'Start date (YYYY-MM-DD)')
    .option('-e, --end <date>', 'End date (YYYY-MM-DD)')
    .option('-p, --preset <preset>', 'Preset: today, 7d, 30d, this_month, last_month')
    .option('--source <source>', 'Filter by source: claude-code, codex, hermes')
    .action(withErrorHandling(async (opts) => {
      renderDailyUsage(opts);
    }));

  usageCmd
    .command('export')
    .description('Export usage data')
    .option('-f, --format <format>', 'Export format: json, csv', 'json')
    .option('-s, --start <date>', 'Start date (YYYY-MM-DD)')
    .option('-e, --end <date>', 'End date (YYYY-MM-DD)')
    .option('-p, --preset <preset>', 'Preset: today, 7d, 30d, this_month, last_month')
    .option('--source <source>', 'Filter by source: claude-code, codex, hermes')
    .action(withErrorHandling(async (opts) => {
      exportUsage(opts);
    }));
}
