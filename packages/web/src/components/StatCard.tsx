'use client';

import { Activity, ArrowDownToLine, ArrowUpFromLine, Braces, Database, Layers3, RefreshCw, ServerCog } from 'lucide-react';
import { useEffect, useRef, useState, useCallback } from 'react';
import { fetchAPI, formatTokens } from '../lib/api';
import { useAutoSync } from '../lib/useAutoSync';

interface Summary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalTokens: number;
  totalSessions: number;
  bySource: Record<string, { inputTokens: number; outputTokens: number; totalTokens: number }>;
  byModel: Record<string, { inputTokens: number; outputTokens: number; totalTokens: number }>;
}

export default function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [preset, setPreset] = useState('today');
  const presetRef = useRef(preset);

  useEffect(() => {
    presetRef.current = preset;
  }, [preset]);

  useEffect(() => {
    let cancelled = false;

    async function loadSummary() {
      setLoading(true);
      try {
        const s = await fetchAPI<Summary>(`/api/usage/summary?preset=${preset}`);
        if (!cancelled) {
          setSummary(s);
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadSummary();

    return () => {
      cancelled = true;
    };
  }, [preset]);

  useAutoSync(useCallback(async () => {
    const s = await fetchAPI<Summary>(`/api/usage/summary?preset=${presetRef.current}`);
    setSummary(s);
  }, []));

  const presets = [
    { key: 'today', label: '今天' },
    { key: '7d', label: '7日' },
    { key: '30d', label: '30日' },
    { key: 'this_month', label: '本月' },
  ];

  if (loading) {
    return (
      <div className="app-panel flex min-h-[360px] items-center justify-center rounded-lg">
        <div className="flex items-center gap-3 text-sm text-[#9ba8a0]">
          <RefreshCw className="h-4 w-4 animate-spin text-[#62c7c9]" />
          正在加载用量数据
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="rounded-lg border border-[#ef6b5d]/30 bg-[#ef6b5d]/10 p-5 text-[#ffb0a7]">
        暂无数据，请确认 API 服务已启动。
      </div>
    );
  }

  const sourceEntries = Object.entries(summary.bySource).sort((a, b) => b[1].totalTokens - a[1].totalTokens);
  const modelEntries = Object.entries(summary.byModel).sort((a, b) => b[1].totalTokens - a[1].totalTokens);
  const maxModelTokens = Math.max(...modelEntries.map(([, data]) => data.totalTokens), 0);
  const topModel = modelEntries[0]?.[0] ?? '暂无模型数据';
  const sourceCount = sourceEntries.length;
  const totalIoTokens = summary.totalInputTokens + summary.totalOutputTokens;
  const outputShare = totalIoTokens > 0 ? Math.round((summary.totalOutputTokens / totalIoTokens) * 100) : 0;

  return (
    <div className="space-y-6">
      <section className="app-panel-strong overflow-hidden rounded-lg p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#62c7c9]/20 bg-[#62c7c9]/[0.08] px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-[#8fdadd]">
              <Activity className="h-3.5 w-3.5" />
              Token 总览
            </div>
            <h2 className="max-w-3xl text-3xl font-semibold tracking-tight text-[#fff9ea] sm:text-4xl">用量总览</h2>
          </div>

          <div className="chip inline-flex w-full rounded-lg p-1 sm:w-auto">
            {presets.map((item) => (
              <button
                key={item.key}
                onClick={() => setPreset(item.key)}
                className={`h-9 flex-1 rounded-md px-3 text-sm font-medium transition-all sm:flex-none ${
                  preset === item.key
                    ? 'bg-[#d5a348] text-[#10120d] shadow-[0_0_22px_rgba(213,163,72,0.18)]'
                    : 'text-[#9ba8a0] hover:bg-white/[0.055] hover:text-[#f4f1e8]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Token 总量', value: formatTokens(summary.totalTokens), icon: Database, accent: 'text-[#f0bf5d]', detail: `${summary.totalSessions} 个会话` },
            { label: '输入 Token', value: formatTokens(summary.totalInputTokens), icon: ArrowDownToLine, accent: 'text-[#62c7c9]', detail: '提示词与缓存写入' },
            { label: '输出 Token', value: formatTokens(summary.totalOutputTokens), icon: ArrowUpFromLine, accent: 'text-[#86b86f]', detail: `占输入输出 ${outputShare}%` },
            { label: '缓存读取', value: formatTokens(summary.totalCacheReadTokens), icon: Braces, accent: 'text-[#eaa568]', detail: `${sourceCount} 个来源` },
          ].map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.label} className="metric-grid rounded-lg border border-white/10 bg-black/[0.18] p-4">
                <div className="mb-5 flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-[0.14em] text-[#798780]">{card.label}</span>
                  <Icon className={`h-4 w-4 ${card.accent}`} />
                </div>
                <div className="tabular text-3xl font-semibold tracking-tight text-[#fff9ea]">{card.value}</div>
                <div className="mt-1 text-sm text-[#9ba8a0]">{card.detail}</div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#d8cfb7]">按来源</h2>
            <span className="text-xs text-[#7f8d86]">按 Token 用量排序</span>
          </div>
          <div className="grid gap-3">
            {sourceEntries.map(([source, data]) => {
              const colors: Record<string, { dot: string; tint: string; label: string }> = {
                'claude-code': { dot: 'bg-[#eaa568]', tint: 'from-[#eaa568]/[0.18]', label: 'Claude Code' },
                codex: { dot: 'bg-[#86b86f]', tint: 'from-[#86b86f]/[0.18]', label: 'Codex' },
                hermes: { dot: 'bg-[#62c7c9]', tint: 'from-[#62c7c9]/[0.18]', label: 'Hermes' },
                opencode: { dot: 'bg-[#7c5cfc]', tint: 'from-[#7c5cfc]/[0.18]', label: 'OpenCode' },
              };
              const color = colors[source] ?? { dot: 'bg-[#d5a348]', tint: 'from-[#d5a348]/[0.18]', label: source };
              const pct = summary.totalTokens > 0 ? Math.round((data.totalTokens / summary.totalTokens) * 100) : 0;

              return (
                <div key={source} className={`app-panel rounded-lg bg-gradient-to-br ${color.tint} to-transparent p-4`}>
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className={`h-2.5 w-2.5 rounded-full ${color.dot} shadow-[0_0_18px_currentColor]`} />
                      <div>
                        <div className="font-medium text-[#fff9ea]">{color.label}</div>
                        <div className="text-xs text-[#8a9992]">{source}</div>
                      </div>
                    </div>
                    <span className="tabular rounded-md border border-white/10 bg-black/[0.18] px-2 py-1 text-xs text-[#d8cfb7]">{pct}%</span>
                  </div>
                  <div className="tabular text-3xl font-semibold text-[#fff9ea]">{formatTokens(data.totalTokens)}</div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-[#9ba8a0]">
                    <div className="rounded-md bg-black/[0.18] px-3 py-2">输入 <span className="tabular text-[#e8e0c8]">{formatTokens(data.inputTokens)}</span></div>
                    <div className="rounded-md bg-black/[0.18] px-3 py-2">输出 <span className="tabular text-[#e8e0c8]">{formatTokens(data.outputTokens)}</span></div>
                  </div>
                </div>
              );
            })}
            {sourceEntries.length === 0 && (
              <div className="app-panel rounded-lg p-5 text-sm text-[#9ba8a0]">暂无来源数据。</div>
            )}
          </div>
        </section>

        <section className="app-panel rounded-lg p-4 sm:p-5">
          <div className="mb-5 flex items-start justify-between gap-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#d8cfb7]">模型分布</h2>
            <div className="flex items-center gap-2 text-xs text-[#9ba8a0]">
              <span>最高用量：<span className="text-[#f4f1e8]">{topModel}</span></span>
              <Layers3 className="h-5 w-5 text-[#62c7c9]" />
            </div>
          </div>

          <div className="space-y-4">
            {modelEntries.map(([model, data]) => {
              const pct = maxModelTokens > 0 ? (data.totalTokens / maxModelTokens) * 100 : 0;
              return (
                <div key={model}>
                  <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                    <div className="min-w-0 truncate font-medium text-[#f4f1e8]">{model}</div>
                    <div className="tabular shrink-0 text-[#d8cfb7]">{formatTokens(data.totalTokens)}</div>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-white/[0.055]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#d5a348] via-[#86b86f] to-[#62c7c9] transition-all duration-700"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="mt-1 flex gap-3 text-xs text-[#7f8d86]">
                    <span>输入 {formatTokens(data.inputTokens)}</span>
                    <span>输出 {formatTokens(data.outputTokens)}</span>
                  </div>
                </div>
              );
            })}
            {modelEntries.length === 0 && (
              <div className="rounded-lg border border-dashed border-white/[0.12] p-6 text-center text-sm text-[#9ba8a0]">
                暂无模型数据。
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="app-panel rounded-lg p-4 text-sm text-[#9ba8a0] sm:flex sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <ServerCog className="h-4 w-4 text-[#86b86f]" />
          每分钟自动同步并刷新当前视图。
        </div>
        <span className="mt-2 block text-xs text-[#73827b] sm:mt-0">当前范围：{presets.find((item) => item.key === preset)?.label}</span>
      </div>
    </div>
  );
}
