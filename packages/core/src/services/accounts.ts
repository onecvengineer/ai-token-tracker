import { CodexConfig } from '../config/codex.js';
import { getBalancesBySource, getCodexAccountStatuses } from '../balance/index.js';
import type { BalanceRateLimits } from '../balance/index.js';
import type { Source } from '../collectors/types.js';

export interface AccountListItem {
  source: Source;
  id: string;
  name: string;
  email: string;
  model: string;
  planType: string;
  isActive: boolean;
  status: 'active' | 'inactive' | 'unknown';
  rateLimits?: BalanceRateLimits;
  manageable: boolean;
}

export interface ListAccountsResult {
  items: AccountListItem[];
  notices: string[];
}

export interface AccountMutationOptions {
  source?: Source;
}

function requireCodexSource(source?: Source): 'codex' {
  const resolvedSource = source ?? 'codex';
  if (resolvedSource !== 'codex') {
    throw new Error(`Account management is not supported for source "${resolvedSource}" yet`);
  }
  return 'codex';
}

export async function listAccounts(options?: {
  source?: Source;
  concurrency?: number;
  timeoutMs?: number;
}): Promise<ListAccountsResult> {
  const source = options?.source;
  const items: AccountListItem[] = [];
  const notices: string[] = [];

  if (!source || source === 'codex') {
    const codexConfig = new CodexConfig();
    const [configAccounts, codexStatuses] = await Promise.all([
      codexConfig.listAccounts(),
      getCodexAccountStatuses({
        concurrency: options?.concurrency ?? 2,
        timeoutMs: options?.timeoutMs ?? 4000,
      }),
    ]);
    const codexStatusesById = new Map(codexStatuses.map((account) => [account.id, account]));

    if (codexConfig.newAccountDetected) {
      notices.push(`Auto-detected new account: "${codexConfig.newAccountDetected}"`);
    }

    items.push(...configAccounts.map((account) => {
      const status = codexStatusesById.get(account.id);
      return {
        source: 'codex' as const,
        id: account.id,
        name: account.name,
        email: status?.email || account.email,
        model: status?.model || '-',
        planType: status?.planType || account.planType,
        isActive: account.isActive,
        status: status?.status || (account.isActive ? 'active' : 'inactive'),
        rateLimits: status?.rateLimits,
        manageable: true,
      };
    }));
  }

  const singleAccountSources = (['claude-code', 'hermes'] as const).filter((candidate) => !source || source === candidate);
  if (singleAccountSources.length > 0) {
    const balances = await getBalancesBySource(singleAccountSources);
    items.push(...balances.map((balance) => ({
      source: balance.source,
      id: `${balance.source}:default`,
      name: balance.accountName,
      email: '-',
      model: balance.model,
      planType: balance.rateLimits?.planType || '-',
      isActive: balance.status === 'active',
      status: balance.status,
      rateLimits: balance.rateLimits,
      manageable: false,
    })));
  }

  const sourceOrder: Source[] = ['claude-code', 'codex', 'hermes'];
  items.sort((a, b) => {
    const sourceDiff = sourceOrder.indexOf(a.source) - sourceOrder.indexOf(b.source);
    if (sourceDiff !== 0) return sourceDiff;
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { items, notices };
}

export async function switchAccount(name: string, options?: AccountMutationOptions): Promise<void> {
  requireCodexSource(options?.source);
  const config = new CodexConfig();
  await config.switchAccount(name);
}

export async function addAccount(
  name: string,
  configValues: Record<string, unknown>,
  options?: AccountMutationOptions,
): Promise<void> {
  requireCodexSource(options?.source);
  const config = new CodexConfig();
  await config.addAccount(name, configValues);
}

export async function removeAccount(name: string, options?: AccountMutationOptions): Promise<void> {
  requireCodexSource(options?.source);
  const config = new CodexConfig();
  await config.removeAccount(name);
}

export async function renameAccount(oldName: string, newName: string, options?: AccountMutationOptions): Promise<void> {
  requireCodexSource(options?.source);
  const config = new CodexConfig();
  await config.renameAccount(oldName, newName);
}

export async function verifyAccount(name: string, options?: AccountMutationOptions): Promise<boolean> {
  requireCodexSource(options?.source);
  const config = new CodexConfig();
  return config.verifyAccount(name);
}
