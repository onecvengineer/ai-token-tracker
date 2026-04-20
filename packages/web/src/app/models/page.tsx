'use client';

import { useEffect, useRef, useState } from 'react';
import { AUTO_SYNC_INTERVAL_MS, fetchAPI, triggerSync } from '../../lib/api';

interface ModelData {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export default function ModelsPage() {
  const [models, setModels] = useState<Record<string, ModelData> | null>(null);
  const [loading, setLoading] = useState(true);
  const syncInFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function loadModels() {
      setLoading(true);
      try {
        const modelData = await fetchAPI<Record<string, ModelData>>('/api/usage/by-model');
        if (!cancelled) {
          setModels(modelData);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadModels();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function syncAndRefresh() {
      if (syncInFlightRef.current) return;
      syncInFlightRef.current = true;
      try {
        await triggerSync().catch(() => undefined);
        const modelData = await fetchAPI<Record<string, ModelData>>('/api/usage/by-model');
        if (!cancelled) {
          setModels(modelData);
        }
      } finally {
        syncInFlightRef.current = false;
      }
    }

    void syncAndRefresh();
    const interval = setInterval(() => {
      void syncAndRefresh();
    }, AUTO_SYNC_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
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
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
