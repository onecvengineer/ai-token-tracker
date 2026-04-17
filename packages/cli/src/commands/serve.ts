import { Command } from 'commander';
import { withErrorHandling } from './shared.js';

export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description('Start the API server')
    .option('-p, --port <port>', 'Port number', '3456')
    .addHelpText('after', `
Examples:
  att serve
  att serve --port 8080
`)
    .action(withErrorHandling(async (opts) => {
      process.env.ATT_PORT = opts.port;
      const { startServer } = await import('@att/api');
      startServer();
    }));
}
