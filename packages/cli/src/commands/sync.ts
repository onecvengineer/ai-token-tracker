import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { ClaudeCodeCollector, CodexCollector, HermesCollector, Repository } from '@att/core';
import type { Source } from '@att/core';
import { withErrorHandling } from './shared.js';

export function registerSyncCommand(program: Command): void {
  program
    .command('sync')
    .description('Sync token usage data from all sources')
    .addHelpText('after', `
Examples:
  att sync
`)
    .action(withErrorHandling(async () => {
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
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          spinner.warn(`${source}: ${message}`);
          spinner = ora();
        }
      }

      spinner.stop();
      repo.close();
      console.log(chalk.green('\nSync complete!'));
    }));
}
