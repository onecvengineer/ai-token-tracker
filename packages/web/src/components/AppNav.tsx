'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard' },
  { href: '/accounts', label: 'Accounts' },
  { href: '/daily', label: 'Daily' },
  { href: '/models', label: 'Models' },
];

export default function AppNav() {
  const pathname = usePathname();

  return (
    <div className="flex gap-4 text-sm text-neutral-400">
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`transition-colors ${
              isActive
                ? 'text-white border-b-2 border-red-400 pb-1'
                : 'hover:text-white'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
