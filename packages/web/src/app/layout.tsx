import type { Metadata } from 'next';
import AppNav from '../components/AppNav';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Token Tracker',
  description: 'Track Claude Code, Codex, and Hermes token usage',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body className="min-h-screen bg-[#0a0a0a] text-white">
        <nav className="border-b border-neutral-800 px-6 py-4">
          <div className="flex items-center gap-6 max-w-7xl mx-auto">
            <h1 className="text-lg font-bold tracking-tight">AI Token Tracker</h1>
            <AppNav />
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-6 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
