"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconGrid, IconTicket, IconWallet, IconBan, IconLogout } from "./icons";

const NAV = [
  { href: "/", label: "Overview", Icon: IconGrid },
  { href: "/raffles", label: "Raffles", Icon: IconTicket },
  { href: "/wallets", label: "Wallets", Icon: IconWallet },
  { href: "/blacklist", label: "Blacklist", Icon: IconBan },
];

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <div className="flex h-full flex-col">
      <Link href="/" onClick={onNavigate} className="mb-8 flex items-center gap-3 px-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-kos-fg text-sm font-black tracking-tight text-kos-bg">
          KOS
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold">KOS WL Bot</div>
          <div className="text-xs text-kos-muted">Raffle Control</div>
        </div>
      </Link>

      <nav className="flex flex-1 flex-col gap-1">
        {NAV.map(({ href, label, Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all ${
                active
                  ? "bg-kos-fg/10 text-kos-fg"
                  : "text-kos-muted hover:bg-kos-fg/5 hover:text-kos-fg"
              }`}
            >
              <Icon className={active ? "text-kos-fg" : "text-kos-muted group-hover:text-kos-fg"} />
              {label}
              {active ? <span className="ml-auto h-1.5 w-1.5 rounded-full bg-kos-fg" /> : null}
            </Link>
          );
        })}
      </nav>

      <div className="mt-6 space-y-3">
        <div className="kos-card p-3.5">
          <div className="flex items-center gap-2 text-xs text-kos-muted">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/40" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400/80" />
            </span>
            Bot connected
          </div>
          <div className="mt-1 text-[11px] text-kos-muted/70">Live · powered by KOS</div>
        </div>
        <form action="/api/auth/logout" method="post">
          <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-kos-muted transition-colors hover:bg-kos-fg/5 hover:text-kos-fg">
            <IconLogout className="text-kos-muted" />
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
