import { Command } from 'commander';
import Table from 'cli-table3';
import chalk from 'chalk';
import { addAccount, listAccounts, removeAccount, renameAccount, switchAccount, verifyAccount } from '@att/core';
import { formatRateLimit, formatStatus, parseSource, printEmptyState, withErrorHandling } from './shared.js';

async function renderAccountsList(opts: { source?: string }): Promise<void> {
  const result = await listAccounts({
    source: parseSource(opts.source),
  });

  for (const notice of result.notices) {
    console.log(chalk.yellow(notice));
  }
  if (result.notices.length > 0) {
    console.log(chalk.gray('Use "att accounts rename <old> <new> --source codex" to rename a Codex account.\n'));
  }

  if (result.items.length === 0) {
    printEmptyState('No accounts found.');
    return;
  }

  const table = new Table({
    head: ['Source', 'Account', 'Email', 'Model', 'Plan', 'Rate Limit', 'Status'],
    style: { head: ['cyan'] },
  });

  for (const item of result.items) {
    const plan = item.planType !== '-'
      ? `${item.planType}${item.quotaScope === 'account' ? ` (${item.quotaProvider || 'account'} account-wide)` : ''}`
      : '-';
    table.push([
      item.source,
      item.name,
      item.email,
      item.model !== '-' ? chalk.cyan(item.model) : '-',
      plan !== '-' ? chalk.cyan(plan) : '-',
      formatRateLimit(item.rateLimits),
      formatStatus(item.status, item.isActive),
    ]);
  }

  console.log(table.toString());
}

export function registerAccountsCommand(program: Command): void {
  const accountsCmd = program
    .command('accounts')
    .description('List accounts by default; manage accounts across sources')
    .option('--source <source>', 'Filter by source: claude-code, codex, hermes')
    .addHelpText('after', `
Examples:
  att accounts
  att accounts --source codex
  att accounts switch my-work --source codex
  att accounts add my-alt --source codex --access-token "eyJ..." --id-token "eyJ..."
  att accounts verify my-alt --source codex
  att accounts add deepseek --source claude-code --api-key "sk-..." --base-url "https://api.deepseek.com" --auth-type auth-token
  att accounts switch deepseek --source claude-code
`)
    .action(withErrorHandling(async (opts) => {
      await renderAccountsList(opts);
    }));

  accountsCmd
    .command('list')
    .description('List accounts across sources')
    .option('--source <source>', 'Filter by source: claude-code, codex, hermes')
    .action(withErrorHandling(async (opts) => {
      await renderAccountsList(opts);
    }));

  accountsCmd
    .command('switch <name>')
    .description('Switch the active account')
    .option('--source <source>', 'Source for account mutation', 'codex')
    .action(withErrorHandling(async (name, opts) => {
      const source = parseSource(opts.source, 'codex');
      await switchAccount(name, { source });
      console.log(chalk.green(`Switched to account "${name}" (${source})`));
    }));

  accountsCmd
    .command('add <name>')
    .description('Add a new account')
    .option('--access-token <token>', 'Access token (Codex)')
    .option('--id-token <token>', 'ID token (Codex)')
    .option('--refresh-token <token>', 'Refresh token (Codex)')
    .option('--account-id <id>', 'Account ID (Codex)')
    .option('--api-key <key>', 'API key (Claude Code provider)')
    .option('--base-url <url>', 'Base URL (Claude Code provider)')
    .option('--auth-type <type>', 'Claude Code auth type: auth-token or api-key')
    .option('--model-sonnet <model>', 'Sonnet model override (Claude Code provider)')
    .option('--model-opus <model>', 'Opus model override (Claude Code provider)')
    .option('--model-haiku <model>', 'Haiku model override (Claude Code provider)')
    .option('--source <source>', 'Source for account mutation', 'codex')
    .action(withErrorHandling(async (name, opts) => {
      const source = parseSource(opts.source, 'codex');

      if (source === 'claude-code') {
        if (!opts.apiKey) {
          throw new Error('--api-key is required for Claude Code provider');
        }
        await addAccount(name, {
          name,
          apiKey: opts.apiKey,
          baseUrl: opts.baseUrl || '',
          authType: opts.authType,
          sonnetModel: opts.modelSonnet || undefined,
          opusModel: opts.modelOpus || undefined,
          haikuModel: opts.modelHaiku || undefined,
        }, { source });
      } else {
        if (!opts.accessToken) {
          throw new Error('--access-token is required for Codex');
        }
        await addAccount(name, {
          auth_mode: 'chatgpt',
          access_token: opts.accessToken,
          id_token: opts.idToken,
          refresh_token: opts.refreshToken,
          account_id: opts.accountId,
        }, { source });
      }
      console.log(chalk.green(`Account "${name}" added (${source})`));
    }));

  accountsCmd
    .command('remove <name>')
    .description('Remove an account')
    .option('--source <source>', 'Source for account mutation', 'codex')
    .action(withErrorHandling(async (name, opts) => {
      const source = parseSource(opts.source, 'codex');
      await removeAccount(name, { source });
      console.log(chalk.green(`Account "${name}" removed (${source})`));
    }));

  accountsCmd
    .command('rename <oldName> <newName>')
    .description('Rename an account')
    .option('--source <source>', 'Source for account mutation', 'codex')
    .action(withErrorHandling(async (oldName, newName, opts) => {
      const source = parseSource(opts.source, 'codex');
      await renameAccount(oldName, newName, { source });
      console.log(chalk.green(`Account "${oldName}" renamed to "${newName}" (${source})`));
    }));

  accountsCmd
    .command('verify <name>')
    .description('Verify an account')
    .option('--source <source>', 'Source for account mutation', 'codex')
    .action(withErrorHandling(async (name, opts) => {
      const source = parseSource(opts.source, 'codex');
      const valid = await verifyAccount(name, { source });
      if (valid) {
        console.log(chalk.green(`Account "${name}" is valid (${source})`));
      } else {
        console.log(chalk.red(`Account "${name}" is invalid or not found (${source})`));
        process.exitCode = 1;
      }
    }));
}
