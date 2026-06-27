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
      {/* Brand */}
      <Link href="/" onClick={onNavigate} className="mb-8 flex items-center gap-3 px-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-sm font-black tracking-tight text-black">
          KOS
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold">KOS WL Bot</div>
          <div className="text-xs text-white/40">Raffle Control</div>
        </div>
      </Link>

      {/* Nav */}
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
                  ? "bg-white/10 text-white"
                  : "text-white/55 hover:bg-white/[0.05] hover:text-white"
              }`}
            >
              <Icon className={active ? "text-white" : "text-white/45 group-hover:text-white"} />
              {label}
              {active ? <span className="ml-auto h-1.5 w-1.5 rounded-full bg-white" /> : null}
            </Link>
          );
        })}
      </nav>

      {/* Status card + sign out */}
      <div className="mt-6 space-y-3">
        <div className="kos-card p-3.5">
          <div className="flex items-center gap-2 text-xs text-white/60">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/40" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400/80" />
            </span>
            Bot connected
          </div>
          <div className="mt-1 text-[11px] text-white/35">Live · powered by KOS</div>
        </div>
        <form action="/api/auth/logout" method="post">
          <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/55 transition-colors hover:bg-white/[0.05] hover:text-white">
            <IconLogout className="text-white/45" />
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
