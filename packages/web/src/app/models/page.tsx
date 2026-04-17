'use client';

import { useEffect, useState } from 'react';

interface ModelData {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUSD: number;
}

export default function ModelsPage() {
  const [models, setModels] = useState<Record<string, ModelData> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('http://localhost:3456/api/usage/by-model')
      .then(r => r.json())
      .then(d => { setModels(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-neutral-500">Loading...</div>;
  if (!models) return <div className="text-red-400">No data</div>;

  const fmt = (n: number) => {
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
  };

  const sorted = Object.entries(models).sort((a, b) => b[1].totalTokens - a[1].totalTokens);
  const maxTokens = sorted.length > 0 ? sorted[0][1].totalTokens : 1;

  return (
    <div>
      <h2 className="text-lg font-semibold mb-6">Model Usage Comparison</h2>
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6">
        {sorted.map(([model, data]) => (
          <div key={model} className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium">{model}</span>
              <span className="text-neutral-400 text-sm">{fmt(data.totalTokens)} tokens</span>
            </div>
            <div className="h-4 bg-neutral-800 rounded-full overflow-hidden mb-2">
              <div
                className="h-full bg-gradient-to-r from-blue-600 to-cyan-500 rounded-full transition-all duration-500"
                style={{ width: `${(data.totalTokens / maxTokens) * 100}%` }}
              />
            </div>
            <div className="flex gap-6 text-sm text-neutral-500">
              <span>Input: {fmt(data.inputTokens)}</span>
              <span>Output: {fmt(data.outputTokens)}</span>
              <span>Cost: ${data.costUSD.toFixed(2)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
