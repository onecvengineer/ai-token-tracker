const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3456';
export const AUTO_SYNC_INTERVAL_MS = 60_000;

export async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function triggerSync(): Promise<void> {
  const res = await fetch(`${API_BASE}/api/sync`, { method: 'POST' });
  if (!res.ok) throw new Error(`Sync error: ${res.status}`);
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
