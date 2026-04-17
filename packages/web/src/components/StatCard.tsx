'use client';

import { useEffect, useState } from 'react';

interface Summary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalTokens: number;
  totalCostUSD: number;
  totalSessions: number;
  bySource: Record<string, { inputTokens: number; outputTokens: number; totalTokens: number; costUSD: number }>;
  byModel: Record<string, { inputTokens: number; outputTokens: number; totalTokens: number; costUSD: number }>;
}

interface Balance {
  source: string;
  accountName: string;
  balance: number | null;
  balanceUnit: string;
  status: string;
}

export default function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [loading, setLoading] = useState(true);
  const [preset, setPreset] = useState('30d');

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [s, b] = await Promise.all([
          fetch(`http://localhost:3456/api/usage/summary?preset=${preset}`).then(r => r.json()),
          fetch('http://localhost:3456/api/accounts/balance').then(r => r.json()),
        ]);
        setSummary(s);
        setBalances(b);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [preset]);

  if (loading) return <div className="text-neutral-500">Loading...</div>;
  if (!summary) return <div className="text-red-400">No data. Make sure the API server is running.</div>;

  const fmt = (n: number) => {
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
  };

  const presets = ['today', '7d', '30d', 'this_month'];

  return (
    <div>
      {/* Time filter */}
      <div className="flex gap-2 mb-6">
        {presets.map(p => (
          <button
            key={p}
            onClick={() => setPreset(p)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              preset === p ? 'bg-blue-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
            }`}
          >
            {p.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Tokens', value: fmt(summary.totalTokens) },
          { label: 'Input Tokens', value: fmt(summary.totalInputTokens) },
          { label: 'Output Tokens', value: fmt(summary.totalOutputTokens) },
          { label: 'Cost', value: `$${summary.totalCostUSD.toFixed(2)}` },
        ].map(card => (
          <div key={card.label} className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
            <div className="text-sm text-neutral-500 mb-1">{card.label}</div>
            <div className="text-2xl font-bold">{card.value}</div>
          </div>
        ))}
      </div>

      {/* By Source */}
      <h2 className="text-lg font-semibold mb-4">By Source</h2>
      <div className="grid grid-cols-3 gap-4 mb-8">
        {Object.entries(summary.bySource).map(([source, data]) => {
          const colors: Record<string, string> = {
            'claude-code': 'from-orange-500 to-amber-500',
            'codex': 'from-green-500 to-emerald-500',
            'hermes': 'from-purple-500 to-violet-500',
          };
          return (
            <div key={source} className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-3 h-3 rounded-full bg-gradient-to-r ${colors[source] || 'from-blue-500 to-blue-600'}`} />
                <span className="font-medium">{source}</span>
              </div>
              <div className="text-3xl font-bold mb-2">{fmt(data.totalTokens)}</div>
              <div className="grid grid-cols-2 gap-2 text-sm text-neutral-400">
                <div>In: {fmt(data.inputTokens)}</div>
                <div>Out: {fmt(data.outputTokens)}</div>
                <div>Cost: ${data.costUSD.toFixed(2)}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* By Model */}
      <h2 className="text-lg font-semibold mb-4">By Model</h2>
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 mb-8">
        {Object.entries(summary.byModel)
          .sort((a, b) => b[1].totalTokens - a[1].totalTokens)
          .map(([model, data]) => {
            const maxTokens = Math.max(...Object.values(summary.byModel).map(d => d.totalTokens));
            const pct = maxTokens > 0 ? (data.totalTokens / maxTokens) * 100 : 0;
            return (
              <div key={model} className="mb-3">
                <div className="flex justify-between text-sm mb-1">
                  <span>{model}</span>
                  <span className="text-neutral-400">{fmt(data.totalTokens)}</span>
                </div>
                <div className="h-2 bg-neutral-800 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-600 rounded-full" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
      </div>

      {/* Account Status */}
      <h2 className="text-lg font-semibold mb-4">Account Status</h2>
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
        {balances.map(b => (
          <div key={b.source} className="flex items-center justify-between py-2 border-b border-neutral-800 last:border-0">
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${b.status === 'active' ? 'bg-green-500' : 'bg-yellow-500'}`} />
              <span className="font-medium">{b.source}</span>
              <span className="text-sm text-neutral-500">{b.accountName}</span>
            </div>
            <span className={`text-sm ${b.status === 'active' ? 'text-green-400' : 'text-yellow-400'}`}>
              {b.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
