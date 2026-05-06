'use client';

import { CheckCircle2, Gauge, KeyRound, RefreshCw, Repeat2, Server, ShieldAlert, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchAPI } from '../../lib/api';

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
  quotaScope?: 'client' | 'account';
  quotaProvider?: string;
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
      remainingPercent: Math.max(0, Math.min(100, 100 - rateLimits.primaryUsedPercent)),
      resetAt: rateLimits.primaryResetAfter != null ? formatResetTime(rateLimits.primaryResetAfter) : undefined,
    });
  }
  if (rateLimits.secondaryUsedPercent != null) {
    parts.push({
      label: '7d',
      remainingPercent: Math.max(0, Math.min(100, 100 - rateLimits.secondaryUsedPercent)),
      resetAt: rateLimits.secondaryResetAfter != null ? formatResetTime(rateLimits.secondaryResetAfter) : undefined,
    });
  }
  return parts;
}

function getCodexAlias(balance: AgentBalance, codexAccounts: CodexAccount[]): string | null {
  if (balance.source !== 'codex') return null;
  return codexAccounts.find((account) => account.email === balance.accountName)?.name ?? null;
}

function formatStatus(status: AgentBalance['status']): string {
  const labels: Record<AgentBalance['status'], string> = {
    active: '使用中',
    inactive: '未启用',
    unknown: '未知',
  };
  return labels[status];
}

function formatQuotaScope(balance: AgentBalance): string | null {
  if (balance.quotaScope !== 'account') return null;
  return `${balance.quotaProvider || balance.accountName} 账号级`;
}

export default function AccountsPage() {
  const [balances, setBalances] = useState<AgentBalance[]>([]);
  const [codexAccounts, setCodexAccounts] = useState<CodexAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    const [balanceData, codexData] = await Promise.all([
      fetchAPI<AgentBalance[]>('/api/accounts/balance'),
      fetchAPI<CodexAccount[]>('/api/config/codex/accounts').catch(() => [] as CodexAccount[]),
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
    await fetchAPI('/api/config/codex/accounts/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    await loadData();
  };

  if (loading) {
    return (
      <div className="app-panel flex min-h-[320px] items-center justify-center rounded-lg">
        <div className="flex items-center gap-3 text-sm text-[#9ba8a0]">
          <RefreshCw className="h-4 w-4 animate-spin text-[#62c7c9]" />
          正在检查账号状态
        </div>
      </div>
    );
  }

  const activeCount = balances.filter((balance) => balance.status === 'active').length;
  const subscriptionCount = balances.filter((balance) => !!balance.rateLimits?.planType || formatRateLimit(balance.rateLimits).length > 0).length;

  return (
    <div className="space-y-6">
      <section className="app-panel-strong rounded-lg p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#86b86f]/25 bg-[#86b86f]/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-[#add49b]">
              <KeyRound className="h-3.5 w-3.5" />
              账号矩阵
            </div>
            <h2 className="text-3xl font-semibold tracking-tight text-[#fff9ea]">账号状态</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:min-w-80">
            <div className="rounded-lg border border-white/10 bg-black/[0.18] p-4">
              <div className="text-xs uppercase tracking-[0.14em] text-[#798780]">使用中</div>
              <div className="tabular mt-2 text-2xl font-semibold text-[#fff9ea]">{activeCount}/{balances.length}</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/[0.18] p-4">
              <div className="text-xs uppercase tracking-[0.14em] text-[#798780]">有限额</div>
              <div className="tabular mt-2 text-2xl font-semibold text-[#fff9ea]">{subscriptionCount}</div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {balances.map((balance, index) => {
          const rateLimitLines = formatRateLimit(balance.rateLimits);
          const hasSubscription = !!balance.rateLimits?.planType || rateLimitLines.length > 0;
          const codexAlias = getCodexAlias(balance, codexAccounts);
          const canSwitch = balance.source === 'codex' && !!codexAlias && balance.status !== 'active';
          const quotaScopeLabel = formatQuotaScope(balance);
          const statusStyles = {
            active: {
              dot: 'bg-[#86b86f]',
              badge: 'border-[#86b86f]/30 bg-[#86b86f]/10 text-[#b7dda8]',
              icon: CheckCircle2,
            },
            inactive: {
              dot: 'bg-[#7f8d86]',
              badge: 'border-white/10 bg-white/[0.04] text-[#9ba8a0]',
              icon: Server,
            },
            unknown: {
              dot: 'bg-[#d5a348]',
              badge: 'border-[#d5a348]/30 bg-[#d5a348]/10 text-[#f0bf5d]',
              icon: ShieldAlert,
            },
          }[balance.status];
          const StatusIcon = statusStyles.icon;

          return (
            <div key={getBalanceKey(balance, index)} className="app-panel flex min-h-full flex-col rounded-lg p-5">
              <div className="mb-5 flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusStyles.dot} shadow-[0_0_18px_currentColor]`} />
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-[#fff9ea]">{balance.source}</div>
                    <div className="truncate text-xs text-[#7f8d86]">
                      {quotaScopeLabel ? `${balance.accountName} · ${quotaScopeLabel}` : balance.accountName}
                    </div>
                  </div>
                </div>
                <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${statusStyles.badge}`}>
                  <StatusIcon className="h-3.5 w-3.5" />
                  {formatStatus(balance.status)}
                </span>
              </div>

              <div className="flex-1 space-y-2 text-sm">
                {codexAlias && (
                  <div className="flex items-center justify-between gap-4 rounded-md bg-black/[0.16] px-3 py-2">
                    <span className="inline-flex items-center gap-2 text-[#7f8d86]"><UserRound className="h-3.5 w-3.5" />别名</span>
                    <span className="truncate text-[#f4f1e8]">{codexAlias}</span>
                  </div>
                )}

                <div className="flex items-center justify-between gap-4 rounded-md bg-black/[0.16] px-3 py-2">
                  <span className="text-[#7f8d86]">账号</span>
                  <span className="min-w-0 truncate text-right text-[#d8cfb7]">{balance.accountName}</span>
                </div>

                <div className="flex items-center justify-between gap-4 rounded-md bg-black/[0.16] px-3 py-2">
                  <span className="text-[#7f8d86]">模型</span>
                  <span className="min-w-0 truncate text-right text-[#f4f1e8]">{balance.model}</span>
                </div>

                {balance.rateLimits?.planType && (
                  <div className="flex items-center justify-between gap-4 rounded-md bg-[#62c7c9]/[0.08] px-3 py-2">
                    <span className="text-[#7f8d86]">{quotaScopeLabel ? '账号套餐' : '套餐'}</span>
                    <span className="text-[#8fdadd]">{balance.rateLimits.planType}</span>
                  </div>
                )}

                {quotaScopeLabel && (
                  <div className="flex items-center justify-between gap-4 rounded-md bg-black/[0.16] px-3 py-2">
                    <span className="text-[#7f8d86]">额度口径</span>
                    <span className="min-w-0 truncate text-right text-[#d8cfb7]">{quotaScopeLabel}</span>
                  </div>
                )}

                {hasSubscription && rateLimitLines.length > 0 && (
                  <div className="border-t border-white/10 pt-3">
                    <div className="mb-2 inline-flex items-center gap-2 text-[#7f8d86]">
                      <Gauge className="h-3.5 w-3.5" />
                      {quotaScopeLabel ? '账号级额度' : '额度'}
                    </div>
                    <div className="space-y-2 text-[#d8cfb7]">
                      {rateLimitLines.map((item) => (
                        <div key={item.label} className="rounded-lg border border-white/10 bg-black/[0.18] px-3 py-2">
                          <div className="flex items-center justify-between gap-4">
                            <span>{item.label}</span>
                            <span className="tabular">{item.remainingPercent}%</span>
                          </div>
                          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.055]">
                            <div
                              className={`h-full rounded-full ${
                                item.remainingPercent >= 50 ? 'bg-[#86b86f]' :
                                item.remainingPercent >= 20 ? 'bg-[#d5a348]' :
                                'bg-[#ef6b5d]'
                              }`}
                              style={{ width: `${item.remainingPercent}%` }}
                            />
                          </div>
                          {item.resetAt && (
                            <div className="mt-2 text-xs font-medium text-[#9ba8a0]">
                              重置时间 {item.resetAt}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {canSwitch && (
                  <div className="border-t border-white/10 pt-3">
                    <button
                      onClick={() => switchAccount(codexAlias)}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[#d5a348]/30 bg-[#d5a348]/10 px-3 py-2 text-sm font-medium text-[#f0bf5d] transition-colors hover:bg-[#d5a348]/[0.16]"
                    >
                      <Repeat2 className="h-4 w-4" />
                      切换到此账号
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {balances.length === 0 && (
        <div className="app-panel rounded-lg p-8 text-center text-sm text-[#9ba8a0]">未检测到账号。</div>
      )}
    </div>
  );
}
