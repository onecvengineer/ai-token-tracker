import type { Metadata } from 'next';
import AppNav from '../components/AppNav';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Token Tracker',
  description: 'AI Token 用量追踪',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body className="min-h-screen text-[#f4f1e8]">
        <nav className="sticky top-0 z-30 border-b border-white/10 bg-[#070b0c]/82 px-4 py-3 backdrop-blur-xl sm:px-6">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-lg border border-[#d5a348]/30 bg-[#d5a348]/10 text-sm font-black text-[#f0bf5d] shadow-[0_0_32px_rgba(213,163,72,0.12)]">
                ATT
              </div>
              <div>
                <h1 className="text-base font-semibold tracking-tight text-[#fff9ea]">AI Token Tracker</h1>
              </div>
            </div>
            <AppNav />
          </div>
        </nav>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
