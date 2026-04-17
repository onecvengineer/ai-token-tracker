import { Command } from 'commander';
import Table from 'cli-table3';
import chalk from 'chalk';
import { listModels, setModel } from '@att/core';
import { parseSource, printEmptyState, withErrorHandling } from './shared.js';

async function renderModelList(opts: { source?: string }): Promise<void> {
  const source = parseSource(opts.source, 'claude-code');
  const models = await listModels({ source });

  if (models.length === 0) {
    printEmptyState('No models available.');
    return;
  }

  const table = new Table({
    head: ['Source', 'ID', 'Name', 'Active'],
    style: { head: ['cyan'] },
  });

  for (const model of models) {
    table.push([
      model.source,
      model.id,
      model.name,
      model.isCurrent ? chalk.green('Yes') : 'No',
    ]);
  }

  console.log(table.toString());
}

export function registerModelCommand(program: Command): void {
  const modelCmd = program
    .command('model')
    .description('List models by default; manage model selection by source')
    .option('--source <source>', 'Source for model operations', 'claude-code')
    .addHelpText('after', `
Examples:
  att model
  att model list --source claude-code
  att model set sonnet --source claude-code
  att model set glm-5.0 --source claude-code --tier opus
`)
    .action(withErrorHandling(async (opts) => {
      await renderModelList(opts);
    }));

  modelCmd
    .command('list')
    .description('List available models')
    .option('--source <source>', 'Source for model operations', 'claude-code')
    .action(withErrorHandling(async (opts) => {
      await renderModelList(opts);
    }));

  modelCmd
    .command('set <model>')
    .description('Set the active model or custom override')
    .option('--source <source>', 'Source for model operations', 'claude-code')
    .option('-t, --tier <tier>', 'Tier for custom models: sonnet, opus, haiku', 'sonnet')
    .action(withErrorHandling(async (model, opts) => {
      const source = parseSource(opts.source, 'claude-code');
      await setModel(model, { source, tier: opts.tier });
      if (['sonnet', 'opus', 'haiku'].includes(model)) {
        console.log(chalk.green(`Reset ${source} ${model} tier to default`));
      } else {
        console.log(chalk.green(`Set ${source} custom model "${model}" for ${opts.tier} tier`));
      }
    }));
}
