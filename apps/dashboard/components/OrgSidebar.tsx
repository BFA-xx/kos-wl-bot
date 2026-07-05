"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useOrg } from "@/lib/org-context";
import {
  IconGrid,
  IconMegaphone,
  IconTicket,
  IconUsers,
  IconWallet,
  IconChart,
  IconDoc,
  IconGear,
  IconCard,
  IconLife,
  IconShield,
  IconLogout,
  IconChevron,
  IconCheck,
  IconPlus,
} from "./icons";

const NAV = [
  { seg: "dashboard", label: "Dashboard", Icon: IconGrid },
  { seg: "campaigns", label: "Campaigns", Icon: IconMegaphone },
  { seg: "raffles", label: "Raffles", Icon: IconTicket },
  { seg: "tasks", label: "Tasks", Icon: IconCheck },
  { seg: "participants", label: "Participants", Icon: IconUsers },
  { seg: "wallets", label: "Wallets", Icon: IconWallet },
  { seg: "analytics", label: "Analytics", Icon: IconChart },
  { seg: "reports", label: "Reports", Icon: IconDoc },
  { seg: "settings", label: "Settings", Icon: IconGear },
  { seg: "team", label: "Team", Icon: IconUsers },
  { seg: "billing", label: "Billing", Icon: IconCard },
  { seg: "support", label: "Support", Icon: IconLife },
];

export function OrgSidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const org = useOrg();
  const pathname = usePathname();
  const base = `/${org.slug}`;
  const isActive = (seg: string) => pathname.startsWith(`${base}/${seg}`);

  return (
    <div className="flex h-full flex-col">
      <OrgSwitcher onNavigate={onNavigate} />

      <nav className="mt-6 flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {NAV.map(({ seg, label, Icon }) => {
          const active = isActive(seg);
          return (
            <Link
              key={seg}
              href={`${base}/${seg}`}
              onClick={onNavigate}
              className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all ${
                active
                  ? "bg-kos-fg/10 text-kos-fg"
                  : "text-kos-muted hover:bg-kos-fg/5 hover:text-kos-fg"
              }`}
            >
              <Icon
                className={active ? "text-kos-fg" : "text-kos-muted group-hover:text-kos-fg"}
              />
              {label}
              {active ? <span className="ml-auto h-1.5 w-1.5 rounded-full bg-kos-fg" /> : null}
            </Link>
          );
        })}
      </nav>

      <div className="mt-4 space-y-2 border-t border-kos-border pt-4">
        {org.isSuperAdmin ? (
          <Link
            href="/admin"
            onClick={onNavigate}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-kos-muted transition-colors hover:bg-kos-fg/5 hover:text-kos-fg"
          >
            <IconShield className="text-kos-muted" />
            Super Admin
          </Link>
        ) : null}
        <div className="flex items-center gap-2.5 px-3 py-1">
          <Link
            href="/me"
            onClick={onNavigate}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg transition-opacity hover:opacity-80"
            title="My KOS profile"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-kos-panel text-[11px] font-bold">
              {org.user.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={org.user.avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                org.user.name.slice(0, 2).toUpperCase()
              )}
            </div>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-xs font-medium">{org.user.name}</div>
              <div className="text-[11px] text-kos-muted">{org.isOwner ? "Owner" : "Member"} · My profile</div>
            </div>
          </Link>
          <form action="/api/auth/logout" method="post" className="ml-auto">
            <button
              className="rounded-lg p-1.5 text-kos-muted transition-colors hover:text-kos-fg"
              aria-label="Sign out"
              title="Sign out"
            >
              <IconLogout />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function OrgSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const org = useOrg();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 rounded-xl border border-kos-border bg-kos-panel/60 px-2.5 py-2 text-left transition-colors hover:bg-kos-panel"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-kos-fg text-[11px] font-black text-kos-bg">
          {org.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={org.logoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            org.name.slice(0, 2).toUpperCase()
          )}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-semibold">{org.name}</div>
          <div className="text-[11px] text-kos-muted">/{org.slug}</div>
        </div>
        <IconChevron
          className={`text-kos-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-40 mt-1.5 overflow-hidden rounded-xl border border-kos-border bg-kos-panel shadow-xl">
          <div className="max-h-60 overflow-y-auto py-1">
            {org.orgs.map((o) => (
              <Link
                key={o.slug}
                href={`/${o.slug}/dashboard`}
                onClick={() => {
                  setOpen(false);
                  onNavigate?.();
                }}
                className="flex items-center gap-2.5 px-2.5 py-2 text-sm hover:bg-kos-fg/5"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-kos-fg/90 text-[10px] font-black text-kos-bg">
                  {o.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={o.logoUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    o.name.slice(0, 2).toUpperCase()
                  )}
                </div>
                <span className="min-w-0 flex-1 truncate">{o.name}</span>
                {o.slug === org.slug ? <IconCheck className="text-kos-fg" /> : null}
              </Link>
            ))}
          </div>
          <Link
            href="/onboarding"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 border-t border-kos-border px-3 py-2.5 text-sm text-kos-muted hover:bg-kos-fg/5 hover:text-kos-fg"
          >
            <IconPlus /> New organization
          </Link>
        </div>
      ) : null}
    </div>
  );
}
