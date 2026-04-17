'use client';

import { useEffect, useState } from 'react';

interface Balance {
  source: string;
  accountName: string;
  balance: number | null;
  balanceUnit: string;
  status: string;
}

interface CodexAccount {
  id: string;
  name: string;
  isActive: boolean;
}

export default function AccountsPage() {
  const [balances, setBalances] = useState<Balance[]>([]);
  const [codexAccounts, setCodexAccounts] = useState<CodexAccount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('http://localhost:3456/api/accounts/balance').then(r => r.json()),
      fetch('http://localhost:3456/api/config/codex/accounts').then(r => r.json()).catch(() => []),
    ]).then(([b, ca]) => {
      setBalances(b);
      setCodexAccounts(ca);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const switchAccount = async (name: string) => {
    await fetch('http://localhost:3456/api/config/codex/accounts/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    // Refresh
    const ca = await fetch('http://localhost:3456/api/config/codex/accounts').then(r => r.json());
    setCodexAccounts(ca);
  };

  if (loading) return <div className="text-neutral-500">Loading...</div>;

  return (
    <div>
      {/* Account Balances */}
      <h2 className="text-lg font-semibold mb-4">Account Status</h2>
      <div className="grid grid-cols-3 gap-4 mb-8">
        {balances.map(b => (
          <div key={b.source} className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className={`w-3 h-3 rounded-full ${b.status === 'active' ? 'bg-green-500' : 'bg-yellow-500'}`} />
              <span className="font-medium">{b.source}</span>
            </div>
            <div className="text-sm text-neutral-400 mb-1">{b.accountName}</div>
            <div className="text-sm">
              Balance: <span className="text-neutral-300">{b.balance !== null ? `${b.balance} ${b.balanceUnit}` : 'N/A'}</span>
            </div>
            <div className={`text-xs mt-1 ${b.status === 'active' ? 'text-green-400' : 'text-yellow-400'}`}>
              {b.status.toUpperCase()}
            </div>
          </div>
        ))}
      </div>

      {/* Codex Account Management */}
      <h2 className="text-lg font-semibold mb-4">Codex Multi-Account</h2>
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
        {codexAccounts.length === 0 ? (
          <div className="text-neutral-500 text-sm">No Codex accounts configured</div>
        ) : (
          <div className="space-y-2">
            {codexAccounts.map(a => (
              <div key={a.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-neutral-800/50">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${a.isActive ? 'bg-green-500' : 'bg-neutral-600'}`} />
                  <span className={a.isActive ? 'font-medium' : 'text-neutral-400'}>{a.name}</span>
                  {a.isActive && <span className="text-xs text-green-400 bg-green-900/30 px-2 py-0.5 rounded">Active</span>}
                </div>
                {!a.isActive && (
                  <button
                    onClick={() => switchAccount(a.name)}
                    className="text-sm px-3 py-1 rounded bg-neutral-700 hover:bg-neutral-600 transition-colors"
                  >
                    Switch
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
