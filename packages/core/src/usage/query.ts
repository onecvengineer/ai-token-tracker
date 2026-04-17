import type { Source } from '../collectors/types.js';

export type UsagePreset = 'today' | '7d' | '30d' | 'this_month' | 'last_month';

export interface UsageQueryOptions {
  start?: string;
  end?: string;
  preset?: string;
  source?: Source;
}

export interface ResolvedUsageWindow {
  startDate?: string;
  endDate?: string;
  source?: Source;
}

function toISODate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function resolveUsageWindow(options: UsageQueryOptions, now = new Date()): ResolvedUsageWindow {
  let startDate = options.start;
  let endDate = options.end;

  if (options.preset) {
    endDate = toISODate(now);

    switch (options.preset as UsagePreset) {
      case 'today':
        startDate = endDate;
        break;
      case '7d':
        startDate = toISODate(new Date(now.getTime() - 7 * 86400000));
        break;
      case '30d':
        startDate = toISODate(new Date(now.getTime() - 30 * 86400000));
        break;
      case 'this_month':
        startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        break;
      case 'last_month': {
        const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
        startDate = toISODate(lastMonthStart);
        endDate = toISODate(lastMonthEnd);
        break;
      }
    }
  }

  return { startDate, endDate, source: options.source };
}
