'use client';

import { BarChart3, Bot, CalendarDays, Gauge } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/', label: '总览', icon: Gauge },
  { href: '/accounts', label: '账号', icon: Bot },
  { href: '/daily', label: '日报', icon: CalendarDays },
  { href: '/models', label: '模型', icon: BarChart3 },
];

export default function AppNav() {
  const pathname = usePathname();

  return (
    <div className="flex flex-wrap items-center gap-1 text-sm text-[#9ba8a0]">
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`group inline-flex h-9 items-center gap-2 rounded-lg border px-3 transition-all ${
              isActive
                ? 'border-[#d5a348]/35 bg-[#d5a348]/[0.12] text-[#fff6df] shadow-[0_0_24px_rgba(213,163,72,0.12)]'
                : 'border-transparent hover:border-white/10 hover:bg-white/[0.045] hover:text-[#f4f1e8]'
            }`}
          >
            <Icon className={`h-4 w-4 ${isActive ? 'text-[#f0bf5d]' : 'text-[#6f817b] group-hover:text-[#62c7c9]'}`} />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
