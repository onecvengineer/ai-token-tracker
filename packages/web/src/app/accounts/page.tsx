'use client';

import { useEffect, useState } from 'react';

interface BalanceRateLimits {
  planType: string | null;
  primaryUsedPercent: number | null;
  primaryResetAfter: number | null;
  secondaryUsedPercent: number | null;
  secondaryResetAfter: number | null;
}

interface AgentBalance {
  source: string;
  accountName: string;
  model: string;
  status: 'active' | 'inactive' | 'unknown';
  rateLimits?: BalanceRateLimits;
}

interface RateLimitItem {
  label: string;
  remainingPercent: number;
  resetAt?: string;
}

interface CodexAccount {
  id: string;
  name: string;
  isActive: boolean;
  email: string;
}

function getBalanceKey(balance: AgentBalance, index: number): string {
  return `${balance.source}:${balance.accountName}:${index}`;
}

function formatResetTime(seconds: number): string {
  const resetAt = new Date(Date.now() + seconds * 1000);
  const month = String(resetAt.getMonth() + 1).padStart(2, '0');
  const day = String(resetAt.getDate()).padStart(2, '0');
  const hour = String(resetAt.getHours()).padStart(2, '0');
  const minute = String(resetAt.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hour}:${minute}`;
}

function formatRateLimit(rateLimits: BalanceRateLimits | undefined): RateLimitItem[] {
  if (!rateLimits) return [];

  const parts: RateLimitItem[] = [];
  if (rateLimits.primaryUsedPercent != null) {
    parts.push({
      label: '5h',
      remainingPercent: 100 - rateLimits.primaryUsedPercent,
      resetAt: rateLimits.primaryResetAfter != null ? formatResetTime(rateLimits.primaryResetAfter) : undefined,
    });
  }
  if (rateLimits.secondaryUsedPercent != null) {
    parts.push({
      label: '7d',
      remainingPercent: 100 - rateLimits.secondaryUsedPercent,
      resetAt: rateLimits.secondaryResetAfter != null ? formatResetTime(rateLimits.secondaryResetAfter) : undefined,
    });
  }
  return parts;
}

function getCodexAlias(balance: AgentBalance, codexAccounts: CodexAccount[]): string | null {
  if (balance.source !== 'codex') return null;
  return codexAccounts.find((account) => account.email === balance.accountName)?.name ?? null;
}

export default function AccountsPage() {
  const [balances, setBalances] = useState<AgentBalance[]>([]);
  const [codexAccounts, setCodexAccounts] = useState<CodexAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    const [balanceData, codexData] = await Promise.all([
      fetch('http://localhost:3456/api/accounts/balance').then(r => r.json()),
      fetch('http://localhost:3456/api/config/codex/accounts').then(r => r.json()).catch(() => []),
    ]);
    setBalances(balanceData);
    setCodexAccounts(codexData);
  };

  useEffect(() => {
    loadData()
      .then(() => {
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const switchAccount = async (name: string) => {
    await fetch('http://localhost:3456/api/config/codex/accounts/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    await loadData();
  };

  if (loading) return <div className="text-neutral-500">Loading...</div>;

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Agent Status</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
        {balances.map((balance, index) => {
          const rateLimitLines = formatRateLimit(balance.rateLimits);
          const hasSubscription = !!balance.rateLimits?.planType || rateLimitLines.length > 0;
          const codexAlias = getCodexAlias(balance, codexAccounts);
          const canSwitch = balance.source === 'codex' && !!codexAlias && balance.status !== 'active';

          return (
            <div key={getBalanceKey(balance, index)} className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${
                    balance.status === 'active' ? 'bg-green-500' :
                    balance.status === 'inactive' ? 'bg-neutral-500' :
                    'bg-yellow-500'
                  }`} />
                  <span className="font-medium">{balance.source}</span>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${
                  balance.status === 'active' ? 'bg-green-900/30 text-green-400' :
                  balance.status === 'inactive' ? 'bg-neutral-800 text-neutral-400' :
                  'bg-yellow-900/30 text-yellow-400'
                }`}>
                  {balance.status.toUpperCase()}
                </span>
              </div>

              <div className="space-y-2 text-sm">
                {codexAlias && (
                  <div className="flex justify-between gap-4">
                    <span className="text-neutral-500">Alias</span>
                    <span className="text-neutral-200">{codexAlias}</span>
                  </div>
                )}

                <div className="flex justify-between gap-4">
                  <span className="text-neutral-500">Account</span>
                  <span className="text-neutral-300">{balance.accountName}</span>
                </div>

                <div className="flex justify-between gap-4">
                  <span className="text-neutral-500">Model</span>
                  <span className="text-neutral-200">{balance.model}</span>
                </div>

                {balance.rateLimits?.planType && (
                  <div className="flex justify-between gap-4">
                    <span className="text-neutral-500">Plan</span>
                    <span className="text-cyan-300">{balance.rateLimits.planType}</span>
                  </div>
                )}

                {hasSubscription && rateLimitLines.length > 0 && (
                  <div className="pt-2 border-t border-neutral-800">
                    <div className="text-neutral-500 mb-2">Limit</div>
                    <div className="space-y-2 text-neutral-200">
                      {rateLimitLines.map((item) => (
                        <div key={item.label} className="rounded-lg bg-neutral-800/40 px-3 py-2">
                          <div className="flex items-center justify-between gap-4">
                            <span>{item.label}</span>
                            <span>{item.remainingPercent}%</span>
                          </div>
                          <div className="mt-2 h-2 rounded-full bg-neutral-800 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                item.remainingPercent >= 50 ? 'bg-green-500' :
                                item.remainingPercent >= 20 ? 'bg-yellow-500' :
                                'bg-red-500'
                              }`}
                              style={{ width: `${item.remainingPercent}%` }}
                            />
                          </div>
                          {item.resetAt && (
                            <div className="mt-2 text-sm font-medium text-neutral-300">
                              Refresh at {item.resetAt}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {canSwitch && (
                  <div className="pt-3 border-t border-neutral-800">
                    <button
                      onClick={() => switchAccount(codexAlias)}
                      className="w-full text-sm px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 transition-colors"
                    >
                      Switch To This Account
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
