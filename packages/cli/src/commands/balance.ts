import { Command } from 'commander';
import Table from 'cli-table3';
import chalk from 'chalk';
import { getAllBalances } from '@att/core';
import { formatRateLimit, formatStatus, withErrorHandling } from './shared.js';

export function registerBalanceCommand(program: Command): void {
  program
    .command('balance')
    .description('Show realtime balance and rate limits across all sources')
    .addHelpText('after', `
Examples:
  att balance
`)
    .action(withErrorHandling(async () => {
      const balances = await getAllBalances();
      const table = new Table({
        head: ['Source', 'Account', 'Model', 'Rate Limit', 'Status'],
        style: { head: ['cyan'] },
      });

      for (const balance of balances) {
        const planPrefix = balance.rateLimits?.planType ? `Plan: ${balance.rateLimits.planType}\n` : '';
        table.push([
          balance.source,
          balance.accountName,
          balance.model !== '-' ? chalk.cyan(balance.model) : '-',
          planPrefix ? planPrefix + formatRateLimit(balance.rateLimits) : formatRateLimit(balance.rateLimits),
          formatStatus(balance.status),
        ]);
      }

      console.log(table.toString());
    }));
}
