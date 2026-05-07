'use client';

import { CheckCircle2, ChevronDown, Gauge, KeyRound, Plus, RefreshCw, Repeat2, Server, ShieldAlert, UserRound, X } from 'lucide-react';
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
  balance?: number | null;
  balanceUnit?: string;
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

interface ClaudeProvider {
  id: string;
  name: string;
  baseUrl: string;
  authType: 'auth-token' | 'api-key';
  isActive: boolean;
  models: { sonnet?: string; opus?: string; haiku?: string };
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

function formatProviderAuth(authType: ClaudeProvider['authType']): string {
  return authType === 'api-key' ? 'X-Api-Key' : 'Bearer Token';
}

function getProviderModel(provider: ClaudeProvider | undefined): string {
  if (!provider) return '-';
  return provider.models.sonnet || provider.models.opus || provider.models.haiku || '-';
}

export default function AccountsPage() {
  const [balances, setBalances] = useState<AgentBalance[]>([]);
  const [codexAccounts, setCodexAccounts] = useState<CodexAccount[]>([]);
  const [claudeProviders, setClaudeProviders] = useState<ClaudeProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showProviderManager, setShowProviderManager] = useState(false);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [addForm, setAddForm] = useState({
    name: '',
    apiKey: '',
    baseUrl: '',
    authType: 'auth-token' as 'auth-token' | 'api-key',
    model: '',
  });
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);

  const PRESET_PROVIDERS: Array<{
    name: string;
    label: string;
    baseUrl: string;
    authType: 'auth-token' | 'api-key';
    model: string;
  }> = [
    { name: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', authType: 'auth-token', model: 'deepseek-chat' },
    { name: 'glm', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', authType: 'auth-token', model: 'glm-4-plus' },
    { name: 'anthropic', label: 'Anthropic', baseUrl: '', authType: 'api-key', model: '' },
  ];

  const applyPreset = (presetName: string) => {
    const preset = PRESET_PROVIDERS.find((p) => p.name === presetName);
    if (preset) {
      setAddForm((f) => ({
        ...f,
        name: preset.name,
        baseUrl: preset.baseUrl,
        authType: preset.authType,
        model: preset.model,
      }));
    }
  };

  const loadData = async () => {
    const [balanceData, codexData, providerData] = await Promise.all([
      fetchAPI<AgentBalance[]>('/api/accounts/balance'),
      fetchAPI<CodexAccount[]>('/api/config/codex/accounts').catch(() => [] as CodexAccount[]),
      fetchAPI<ClaudeProvider[]>('/api/config/claude/providers').catch(() => [] as ClaudeProvider[]),
    ]);
    setBalances(balanceData);
    setCodexAccounts(codexData);
    setClaudeProviders(providerData);
  };

  useEffect(() => {
    loadData()
      .then(() => {
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const switchCodexAccount = async (name: string) => {
    await fetchAPI('/api/config/codex/accounts/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    await loadData();
  };

  const switchClaudeProvider = async (name: string) => {
    await fetchAPI('/api/config/claude/providers/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    await loadData();
  };

  const removeClaudeProvider = async (name: string) => {
    await fetchAPI(`/api/config/claude/providers/${encodeURIComponent(name)}`, { method: 'DELETE' });
    await loadData();
  };

  const handleAddProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm.name.trim() || !addForm.apiKey.trim()) {
      setAddError('名称和 API Key 为必填');
      return;
    }
    setAdding(true);
    setAddError('');
    try {
      await fetchAPI('/api/config/claude/providers/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: addForm.name.trim(),
          apiKey: addForm.apiKey.trim(),
          baseUrl: addForm.baseUrl.trim() || undefined,
          authType: addForm.authType,
          sonnetModel: addForm.model.trim() || undefined,
        }),
      });
      setShowAddProvider(false);
      setShowProviderManager(false);
      setAddForm({ name: '', apiKey: '', baseUrl: '', authType: 'auth-token', model: '' });
      await loadData();
    } catch (err: any) {
      setAddError(err.message || '添加失败');
    } finally {
      setAdding(false);
    }
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
  const activeClaudeProvider = claudeProviders.find((provider) => provider.isActive);
  const providerSummaryName = activeClaudeProvider?.name || (claudeProviders.length > 0 ? '未启用' : '未配置');
  const providerSummaryMeta = activeClaudeProvider
    ? `${formatProviderAuth(activeClaudeProvider.authType)} · ${getProviderModel(activeClaudeProvider)}`
    : claudeProviders.length > 0
      ? `${claudeProviders.length} 个服务商`
      : '添加后可快速切换 Claude Code 服务商';

  const providerManagerSection = (
    <section className="app-panel rounded-lg px-4 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#eaa568]/20 bg-[#eaa568]/10 text-[#eaa568]">
            <KeyRound className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-[#eaa568]">Claude Code 服务商</span>
              {activeClaudeProvider && (
                <span className="rounded-full border border-[#86b86f]/25 bg-[#86b86f]/10 px-2 py-0.5 text-[10px] font-medium text-[#b7dda8]">
                  使用中
                </span>
              )}
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#7f8d86]">
              <span className="font-medium text-[#f4f1e8]">{providerSummaryName}</span>
              <span className="truncate">{providerSummaryMeta}</span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            onClick={() => {
              setShowProviderManager((value) => !value);
              if (showProviderManager) {
                setShowAddProvider(false);
                setAddError('');
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-[#9ba8a0] transition-colors hover:bg-white/[0.08] hover:text-[#f4f1e8]"
          >
            管理
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showProviderManager ? 'rotate-180' : ''}`} />
          </button>
          <button
            onClick={() => {
              setShowProviderManager(true);
              setShowAddProvider(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#d5a348]/30 bg-[#d5a348]/10 px-3 py-1.5 text-xs font-medium text-[#f0bf5d] transition-colors hover:bg-[#d5a348]/[0.16]"
          >
            <Plus className="h-3.5 w-3.5" />
            添加服务商
          </button>
        </div>
      </div>

      {showProviderManager && (
        <div className="mt-4 border-t border-white/10 pt-4">
          {claudeProviders.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {claudeProviders.map((provider) => {
                const isActiveProvider = provider.isActive;
                const statusStyle = isActiveProvider
                  ? { dot: 'bg-[#86b86f]', badge: 'border-[#86b86f]/30 bg-[#86b86f]/10 text-[#b7dda8]' }
                  : { dot: 'bg-[#7f8d86]', badge: 'border-white/10 bg-white/[0.04] text-[#9ba8a0]' };

                return (
                  <div key={provider.id} className={`rounded-lg border p-3 ${isActiveProvider ? 'border-[#86b86f]/20 bg-[#86b86f]/[0.04]' : 'border-white/10 bg-black/[0.12]'}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className={`h-2 w-2 shrink-0 rounded-full ${statusStyle.dot}`} />
                        <span className="truncate text-sm font-semibold text-[#fff9ea]">{provider.name}</span>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusStyle.badge}`}>
                        {isActiveProvider ? '使用中' : '未启用'}
                      </span>
                    </div>

                    <div className="mt-3 space-y-1.5 text-xs text-[#7f8d86]">
                      <div className="flex justify-between gap-3">
                        <span>认证</span>
                        <span className="truncate text-[#d8cfb7]">{formatProviderAuth(provider.authType)}</span>
                      </div>
                      {provider.baseUrl && (
                        <div className="flex justify-between gap-3">
                          <span>Base URL</span>
                          <span className="truncate text-[#d8cfb7]">{provider.baseUrl}</span>
                        </div>
                      )}
                      {getProviderModel(provider) !== '-' && (
                        <div className="flex justify-between gap-3">
                          <span>模型</span>
                          <span className="truncate text-[#d8cfb7]">{getProviderModel(provider)}</span>
                        </div>
                      )}
                    </div>

                    {!isActiveProvider && (
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => switchClaudeProvider(provider.id)}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-[#d5a348]/30 bg-[#d5a348]/10 px-2 py-1.5 text-xs font-medium text-[#f0bf5d] transition-colors hover:bg-[#d5a348]/[0.16]"
                        >
                          <Repeat2 className="h-3 w-3" />
                          切换
                        </button>
                        <button
                          onClick={() => removeClaudeProvider(provider.id)}
                          className="inline-flex items-center justify-center rounded-md border border-[#ef6b5d]/20 bg-transparent px-2 py-1.5 text-xs text-[#ef6b5d]/70 transition-colors hover:bg-[#ef6b5d]/10 hover:text-[#ef6b5d]"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-white/10 bg-black/[0.12] px-3 py-2 text-sm text-[#7f8d86]">
              暂无配置的服务商。
            </div>
          )}

          {showAddProvider && (
            <div className="mt-4 rounded-lg border border-[#d5a348]/20 bg-black/[0.16] p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-medium text-[#f4f1e8]">添加新服务商</span>
                <button onClick={() => { setShowAddProvider(false); setAddError(''); }} className="text-[#7f8d86] hover:text-[#f4f1e8]">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mb-3 flex flex-wrap gap-2">
                {PRESET_PROVIDERS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => applyPreset(preset.name)}
                    className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-[#9ba8a0] transition-colors hover:bg-white/[0.08] hover:text-[#f4f1e8]"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <form onSubmit={handleAddProvider} className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs text-[#7f8d86]">名称 *</label>
                    <input
                      type="text"
                      value={addForm.name}
                      onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="deepseek"
                      className="w-full rounded-md border border-white/10 bg-black/[0.24] px-3 py-2 text-sm text-[#f4f1e8] placeholder-[#7f8d86]/60 outline-none focus:border-[#d5a348]/40"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-[#7f8d86]">API Key *</label>
                    <input
                      type="password"
                      value={addForm.apiKey}
                      onChange={(e) => setAddForm((f) => ({ ...f, apiKey: e.target.value }))}
                      placeholder="sk-..."
                      className="w-full rounded-md border border-white/10 bg-black/[0.24] px-3 py-2 text-sm text-[#f4f1e8] placeholder-[#7f8d86]/60 outline-none focus:border-[#d5a348]/40"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-[#7f8d86]">Base URL</label>
                    <input
                      type="text"
                      value={addForm.baseUrl}
                      onChange={(e) => setAddForm((f) => ({ ...f, baseUrl: e.target.value }))}
                      placeholder="https://api.deepseek.com"
                      className="w-full rounded-md border border-white/10 bg-black/[0.24] px-3 py-2 text-sm text-[#f4f1e8] placeholder-[#7f8d86]/60 outline-none focus:border-[#d5a348]/40"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-[#7f8d86]">认证方式</label>
                    <select
                      value={addForm.authType}
                      onChange={(e) => setAddForm((f) => ({ ...f, authType: e.target.value as 'auth-token' | 'api-key' }))}
                      className="w-full rounded-md border border-white/10 bg-black/[0.24] px-3 py-2 text-sm text-[#f4f1e8] outline-none focus:border-[#d5a348]/40"
                    >
                      <option value="auth-token">Bearer Token</option>
                      <option value="api-key">X-Api-Key</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-[#7f8d86]">模型</label>
                    <input
                      type="text"
                      value={addForm.model}
                      onChange={(e) => setAddForm((f) => ({ ...f, model: e.target.value }))}
                      placeholder="deepseek-chat"
                      className="w-full rounded-md border border-white/10 bg-black/[0.24] px-3 py-2 text-sm text-[#f4f1e8] placeholder-[#7f8d86]/60 outline-none focus:border-[#d5a348]/40"
                    />
                  </div>
                </div>
                {addError && <div className="text-xs text-[#ef6b5d]">{addError}</div>}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => { setShowAddProvider(false); setAddError(''); }}
                    className="rounded-md border border-white/10 bg-transparent px-4 py-2 text-sm text-[#9ba8a0] transition-colors hover:bg-white/[0.04]"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={adding}
                    className="rounded-md border border-[#d5a348]/30 bg-[#d5a348]/10 px-4 py-2 text-sm font-medium text-[#f0bf5d] transition-colors hover:bg-[#d5a348]/[0.16] disabled:opacity-50"
                  >
                    {adding ? '添加中...' : '添加'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}
    </section>
  );

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

                {/* Balance display for providers with monetary balance (DeepSeek, Zhipu) */}
                {balance.balance != null && balance.balanceUnit && balance.balanceUnit !== 'tokens' && (
                  <div className="flex items-center justify-between gap-4 rounded-md bg-[#86b86f]/[0.08] px-3 py-2">
                    <span className="text-[#7f8d86]">余额</span>
                    <span className="tabular font-semibold text-[#86b86f]">{balance.balance.toFixed(2)} {balance.balanceUnit}</span>
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
                      onClick={() => switchCodexAccount(codexAlias)}
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

      {providerManagerSection}
    </div>
  );
}
