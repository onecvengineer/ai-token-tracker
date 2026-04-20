'use client';

import { useEffect, useRef, useState } from 'react';
import { AUTO_SYNC_INTERVAL_MS, fetchAPI, triggerSync } from '../../lib/api';

interface DailyUsage {
  date: string;
  source: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  costUSD: number | null;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}

export default function DailyPage() {
  const [data, setData] = useState<DailyUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [preset, setPreset] = useState('30d');
  const syncInFlightRef = useRef(false);
  const presetRef = useRef(preset);

  useEffect(() => {
    presetRef.current = preset;
  }, [preset]);

  useEffect(() => {
    let cancelled = false;

    async function loadDaily() {
      setLoading(true);
      try {
        const dailyData = await fetchAPI<DailyUsage[]>(`/api/usage/daily?preset=${preset}`);
        if (!cancelled) {
          setData(dailyData);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadDaily();

    return () => {
      cancelled = true;
    };
  }, [preset]);

  useEffect(() => {
    let cancelled = false;

    async function syncAndRefresh() {
      if (syncInFlightRef.current) return;
      syncInFlightRef.current = true;
      try {
        await triggerSync().catch(() => undefined);
        const dailyData = await fetchAPI<DailyUsage[]>(`/api/usage/daily?preset=${presetRef.current}`);
        if (!cancelled) {
          setData(dailyData);
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

  const fmt = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
  };

  return (
    <div>
      <div className="flex gap-2 mb-6">
        {['7d', '30d'].map(p => (
          <button
            key={p}
            onClick={() => setPreset(p)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              preset === p ? 'bg-blue-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-left text-neutral-400">
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Model</th>
              <th className="px-4 py-3 text-right">Total Tokens</th>
              <th className="px-4 py-3 text-right">Sessions</th>
              <th className="px-4 py-3 text-right">Messages</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={i} className="border-b border-neutral-800/50 hover:bg-neutral-800/30">
                <td className="px-4 py-2.5 font-mono text-sm">{d.date}</td>
                <td className="px-4 py-2.5">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                    d.source === 'claude-code' ? 'bg-orange-900/30 text-orange-400' :
                    d.source === 'codex' ? 'bg-green-900/30 text-green-400' :
                    'bg-purple-900/30 text-purple-400'
                  }`}>
                    {d.source}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-neutral-300">{d.model}</td>
                <td className="px-4 py-2.5 text-right font-mono">{fmt(d.totalTokens)}</td>
                <td className="px-4 py-2.5 text-right text-neutral-400">{d.sessionCount}</td>
                <td className="px-4 py-2.5 text-right text-neutral-400">{d.messageCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.length === 0 && (
          <div className="text-center py-8 text-neutral-500">No data available</div>
        )}
      </div>
    </div>
  );
}
