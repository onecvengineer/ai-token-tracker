#!/usr/bin/env node
import { Command } from 'commander';
import { registerAccountsCommand } from './commands/accounts.js';
import { registerBalanceCommand } from './commands/balance.js';
import { registerModelCommand } from './commands/model.js';
import { registerServeCommand } from './commands/serve.js';
import { registerSyncCommand } from './commands/sync.js';
import { registerUsageCommand } from './commands/usage.js';

const program = new Command();

program
  .name('att')
  .description('AI Token Tracker - task-oriented CLI for usage, accounts, balance, and models')
  .version('0.1.0');

registerSyncCommand(program);
registerUsageCommand(program);
registerAccountsCommand(program);
registerBalanceCommand(program);
registerModelCommand(program);
registerServeCommand(program);

program.parse();
