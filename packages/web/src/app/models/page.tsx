'use client';

import { ArrowDownToLine, ArrowUpFromLine, Cpu, Layers3, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { fetchAPI, formatTokens } from '../../lib/api';
import { useAutoSync } from '../../lib/useAutoSync';

interface ModelData {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export default function ModelsPage() {
  const [models, setModels] = useState<Record<string, ModelData> | null>(null);
  const [loading, setLoading] = useState(true);

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

  useAutoSync(useCallback(async () => {
    const modelData = await fetchAPI<Record<string, ModelData>>('/api/usage/by-model');
    setModels(modelData);
  }, []));

  if (loading) {
    return (
      <div className="app-panel flex min-h-[320px] items-center justify-center rounded-lg">
        <div className="flex items-center gap-3 text-sm text-[#9ba8a0]">
          <RefreshCw className="h-4 w-4 animate-spin text-[#62c7c9]" />
          正在加载模型数据
        </div>
      </div>
    );
  }

  if (!models) {
    return (
      <div className="rounded-lg border border-[#ef6b5d]/30 bg-[#ef6b5d]/10 p-5 text-[#ffb0a7]">
        暂无数据
      </div>
    );
  }

  const sorted = Object.entries(models).sort((a, b) => b[1].totalTokens - a[1].totalTokens);
  const maxTokens = Math.max(sorted[0]?.[1].totalTokens ?? 0, 1);
  const totalTokens = sorted.reduce((sum, [, data]) => sum + data.totalTokens, 0);
  const totalInputTokens = sorted.reduce((sum, [, data]) => sum + data.inputTokens, 0);
  const totalOutputTokens = sorted.reduce((sum, [, data]) => sum + data.outputTokens, 0);

  return (
    <div className="space-y-6">
      <section className="app-panel-strong rounded-lg p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#d5a348]/25 bg-[#d5a348]/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-[#f0bf5d]">
              <Cpu className="h-3.5 w-3.5" />
              模型
            </div>
            <h2 className="text-3xl font-semibold tracking-tight text-[#fff9ea]">模型用量</h2>
          </div>
          <div className="grid grid-cols-3 gap-3 sm:min-w-[420px]">
            {[
              { label: '模型数', value: sorted.length.toLocaleString(), icon: Layers3 },
              { label: '输入', value: formatTokens(totalInputTokens), icon: ArrowDownToLine },
              { label: '输出', value: formatTokens(totalOutputTokens), icon: ArrowUpFromLine },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="rounded-lg border border-white/10 bg-black/[0.18] p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs uppercase tracking-[0.14em] text-[#798780]">{item.label}</span>
                    <Icon className="h-4 w-4 text-[#62c7c9]" />
                  </div>
                  <div className="tabular text-xl font-semibold text-[#fff9ea]">{item.value}</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <div className="app-panel rounded-lg p-4 sm:p-6">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#d8cfb7]">模型排行</h3>
          <span className="tabular text-xs text-[#7f8d86]">共 {formatTokens(totalTokens)} Token</span>
        </div>
        <div className="space-y-5">
          {sorted.map(([model, data]) => (
            <div key={model} className="rounded-lg border border-white/10 bg-black/[0.16] p-4">
              <div className="mb-3 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-[#fff9ea]">{model}</div>
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-[#7f8d86]">
                    <span>输入 {formatTokens(data.inputTokens)}</span>
                    <span>输出 {formatTokens(data.outputTokens)}</span>
                  </div>
                </div>
                <span className="tabular shrink-0 text-sm text-[#d8cfb7]">{formatTokens(data.totalTokens)} Token</span>
              </div>
              <div className="mb-3 h-3 overflow-hidden rounded-full bg-white/[0.055]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#d5a348] via-[#86b86f] to-[#62c7c9] transition-all duration-700"
                  style={{ width: `${(data.totalTokens / maxTokens) * 100}%` }}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.055]">
                  <div
                    className="h-full rounded-full bg-[#62c7c9]"
                    style={{ width: `${data.totalTokens > 0 ? (data.inputTokens / data.totalTokens) * 100 : 0}%` }}
                  />
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.055]">
                  <div
                    className="h-full rounded-full bg-[#d5a348]"
                    style={{ width: `${data.totalTokens > 0 ? (data.outputTokens / data.totalTokens) * 100 : 0}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        {sorted.length === 0 && (
          <div className="rounded-lg border border-dashed border-white/[0.12] p-10 text-center text-sm text-[#9ba8a0]">
            暂无模型数据。
          </div>
        )}
      </div>
    </div>
  );
}
