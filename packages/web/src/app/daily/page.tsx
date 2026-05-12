'use client';

import { CalendarRange, Database, MessagesSquare, RefreshCw, Rows3, TimerReset } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAPI, formatTokens } from '../../lib/api';
import { useAutoSync } from '../../lib/useAutoSync';

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

  useAutoSync(useCallback(async () => {
    const dailyData = await fetchAPI<DailyUsage[]>(`/api/usage/daily?preset=${presetRef.current}`);
    setData(dailyData);
  }, []));

  if (loading) {
    return (
      <div className="app-panel flex min-h-[320px] items-center justify-center rounded-lg">
        <div className="flex items-center gap-3 text-sm text-[#9ba8a0]">
          <RefreshCw className="h-4 w-4 animate-spin text-[#62c7c9]" />
          正在加载日报数据
        </div>
      </div>
    );
  }

  const presets = [
    { key: '7d', label: '7D' },
    { key: '30d', label: '30D' },
  ];
  const totalTokens = data.reduce((sum, item) => sum + item.totalTokens, 0);
  const totalSessions = data.reduce((sum, item) => sum + item.sessionCount, 0);
  const totalMessages = data.reduce((sum, item) => sum + item.messageCount, 0);
  const activeSources = new Set(data.map((item) => item.source)).size;

  return (
    <div className="space-y-6">
      <section className="app-panel-strong rounded-lg p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#62c7c9]/25 bg-[#62c7c9]/[0.08] px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-[#8fdadd]">
              <CalendarRange className="h-3.5 w-3.5" />
              日报
            </div>
            <h2 className="text-3xl font-semibold tracking-tight text-[#fff9ea]">每日用量</h2>
          </div>

          <div className="chip inline-flex w-full rounded-lg p-1 sm:w-auto">
            {presets.map((item) => (
              <button
                key={item.key}
                onClick={() => setPreset(item.key)}
                className={`h-9 flex-1 rounded-md px-4 text-sm font-medium transition-all sm:flex-none ${
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
            { label: 'Token 总量', value: formatTokens(totalTokens), icon: Database },
            { label: '会话', value: totalSessions.toLocaleString(), icon: Rows3 },
            { label: '消息', value: totalMessages.toLocaleString(), icon: MessagesSquare },
            { label: '来源', value: activeSources.toLocaleString(), icon: TimerReset },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="rounded-lg border border-white/10 bg-black/[0.18] p-4">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-xs uppercase tracking-[0.14em] text-[#798780]">{item.label}</span>
                  <Icon className="h-4 w-4 text-[#62c7c9]" />
                </div>
                <div className="tabular text-2xl font-semibold text-[#fff9ea]">{item.value}</div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="app-panel overflow-hidden rounded-lg">
        <div className="border-b border-white/10 px-4 py-3 sm:px-5">
          <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#d8cfb7]">明细</h3>
        </div>
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[780px] text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-black/20 text-left text-xs uppercase tracking-[0.12em] text-[#798780]">
                <th className="px-4 py-3 font-medium">日期</th>
                <th className="px-4 py-3 font-medium">来源</th>
                <th className="px-4 py-3 font-medium">模型</th>
                <th className="px-4 py-3 text-right font-medium">Token 总量</th>
                <th className="px-4 py-3 text-right font-medium">会话</th>
                <th className="px-4 py-3 text-right font-medium">消息</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d, i) => (
                <tr key={i} className="border-b border-white/[0.06] transition-colors hover:bg-white/[0.035]">
                  <td className="tabular px-4 py-3 text-sm text-[#f4f1e8]">{d.date}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${
                      d.source === 'claude-code' ? 'border-[#eaa568]/25 bg-[#eaa568]/10 text-[#ffc68e]' :
                      d.source === 'codex' ? 'border-[#86b86f]/25 bg-[#86b86f]/10 text-[#b7dda8]' :
                      d.source === 'opencode' ? 'border-[#7c5cfc]/25 bg-[#7c5cfc]/10 text-[#a88cff]' :
                      'border-[#62c7c9]/25 bg-[#62c7c9]/10 text-[#8fdadd]'
                    }`}>
                      {d.source}
                    </span>
                  </td>
                  <td className="max-w-[280px] truncate px-4 py-3 text-[#d8cfb7]">{d.model}</td>
                  <td className="tabular px-4 py-3 text-right text-[#fff9ea]">{formatTokens(d.totalTokens)}</td>
                  <td className="tabular px-4 py-3 text-right text-[#9ba8a0]">{d.sessionCount}</td>
                  <td className="tabular px-4 py-3 text-right text-[#9ba8a0]">{d.messageCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.length === 0 && (
          <div className="py-10 text-center text-sm text-[#9ba8a0]">暂无数据</div>
        )}
      </div>
    </div>
  );
}
