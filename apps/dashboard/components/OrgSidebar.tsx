"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
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
  IconLife,
  IconShield,
  IconLogout,
  IconChevron,
  IconCheck,
  IconPlus,
  IconCard,
  IconTag,
} from "./icons";

const NAV: {
  seg: string;
  label: string;
  Icon: typeof IconGrid;
  soon?: boolean;
}[] = [
  { seg: "dashboard", label: "Dashboard", Icon: IconGrid },
  { seg: "campaigns", label: "Campaigns", Icon: IconMegaphone },
  { seg: "collabs", label: "Collab Hub", Icon: IconTag },
  { seg: "raffles", label: "Raffles", Icon: IconTicket },
  { seg: "tasks", label: "Tasks", Icon: IconCheck },
  { seg: "participants", label: "Participants", Icon: IconUsers },
  { seg: "points", label: "Points", Icon: IconChart },
  { seg: "rewards", label: "Rewards", Icon: IconCard },
  { seg: "wallets", label: "Wallets", Icon: IconWallet },
  { seg: "analytics", label: "Analytics", Icon: IconChart },
  { seg: "reports", label: "Reports", Icon: IconDoc },
  { seg: "settings", label: "Settings", Icon: IconGear },
  { seg: "team", label: "Team", Icon: IconUsers },
  // Billing intentionally hidden until paid plans launch (page still exists).
  { seg: "support", label: "Support", Icon: IconLife },
];

export function OrgSidebarContent({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const org = useOrg();
  const pathname = usePathname();
  const base = `/${org.slug}`;
  const isActive = (seg: string) => pathname.startsWith(`${base}/${seg}`);

  return (
    <div className="flex h-full flex-col">
      <OrgSwitcher onNavigate={onNavigate} collapsed={collapsed} />

      <nav className="mt-6 flex flex-1 flex-col gap-1 overflow-y-auto">
        {NAV.filter((item) => {
          if (item.seg === "collabs")
            return org.isOwner || org.permissions.includes("collab:view");
          if (item.seg === "campaigns")
            return org.isOwner || org.permissions.includes("campaign:view");
          return true;
        }).map(({ seg, label, Icon, soon }) => {
          const active = isActive(seg);
          const cls = `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all ${
            active
              ? "bg-blue-500/12 text-white shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]"
              : "text-kos-muted hover:bg-white/[0.045] hover:text-kos-fg"
          } ${collapsed ? "justify-center" : ""}`;

          if (soon) {
            return (
              <div
                key={seg}
                className={`${cls} cursor-not-allowed opacity-60`}
                title={`${label} coming soon`}
              >
                <Icon className="text-kos-muted" />
                {collapsed ? null : <span className="truncate">{label}</span>}
                {collapsed ? null : (
                  <span className="ml-auto rounded-full border border-white/[0.08] px-1.5 py-0.5 text-[10px] text-kos-muted">
                    Soon
                  </span>
                )}
              </div>
            );
          }

          return (
            <Link
              key={seg}
              href={`${base}/${seg}`}
              onClick={onNavigate}
              className={cls}
              title={collapsed ? label : undefined}
            >
              <Icon
                className={
                  active
                    ? "text-blue-300"
                    : "text-kos-muted group-hover:text-kos-fg"
                }
              />
              {collapsed ? null : <span className="truncate">{label}</span>}
              {active ? (
                <span
                  className={`${collapsed ? "absolute right-1.5" : "ml-auto"} h-1.5 w-1.5 rounded-full bg-blue-400`}
                />
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="mt-4 space-y-2 border-t border-white/[0.08] pt-4">
        {org.isSuperAdmin ? (
          <Link
            href="/admin"
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-kos-muted transition-colors hover:bg-white/[0.045] hover:text-kos-fg ${collapsed ? "justify-center" : ""}`}
            title={collapsed ? "Super Admin" : undefined}
          >
            <IconShield className="text-kos-muted" />
            {collapsed ? null : "Super Admin"}
          </Link>
        ) : null}
        <div
          className={`flex items-center gap-2.5 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-2.5 py-2 ${collapsed ? "justify-center" : ""}`}
        >
          <Link
            href="/me"
            onClick={onNavigate}
            className={`flex min-w-0 items-center gap-2.5 rounded-lg transition-opacity hover:opacity-80 ${collapsed ? "" : "flex-1"}`}
            title="My KOS profile"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-kos-panel text-[11px] font-bold">
              {org.user.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={org.user.avatarUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                org.user.name.slice(0, 2).toUpperCase()
              )}
            </div>
            {collapsed ? null : (
              <div className="min-w-0 leading-tight">
                <div className="truncate text-xs font-medium">
                  {org.user.name}
                </div>
                <div className="text-[11px] text-kos-muted">
                  {org.isOwner ? "Owner" : "Member"} · My profile
                </div>
              </div>
            )}
          </Link>
          {collapsed ? null : (
            <form action="/api/auth/logout" method="post" className="ml-auto">
              <button
                className="rounded-lg p-1.5 text-kos-muted transition-colors hover:text-kos-fg"
                aria-label="Sign out"
                title="Sign out"
              >
                <IconLogout />
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function OrgSwitcher({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const org = useOrg();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`flex w-full items-center gap-3 rounded-2xl border border-white/[0.09] bg-white/[0.04] px-2.5 py-2 text-left shadow-[0_1px_0_rgba(255,255,255,0.05)_inset] transition-colors hover:bg-white/[0.065] ${collapsed ? "justify-center" : ""}`}
        title={collapsed ? org.name : undefined}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-kos-fg text-[11px] font-black text-kos-bg">
          {org.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={org.logoUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            org.name.slice(0, 2).toUpperCase()
          )}
        </div>
        {collapsed ? null : (
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-semibold">{org.name}</div>
            <div className="text-[11px] text-kos-muted">/{org.slug}</div>
          </div>
        )}
        {collapsed ? null : (
          <IconChevron
            className={`text-kos-muted transition-transform ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {open ? (
        <div
          className={`absolute top-full z-40 mt-1.5 overflow-hidden rounded-2xl border border-white/[0.09] bg-[#111] shadow-2xl ${collapsed ? "left-0 w-72" : "left-0 right-0"}`}
        >
          <div className="max-h-60 overflow-y-auto py-1">
            {org.orgs.map((o) => (
              <Link
                key={o.slug}
                href={`/${o.slug}/dashboard`}
                onClick={() => {
                  setOpen(false);
                  onNavigate?.();
                }}
                className="flex items-center gap-2.5 px-2.5 py-2 text-sm hover:bg-white/[0.045]"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-kos-fg/90 text-[10px] font-black text-kos-bg">
                  {o.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={o.logoUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    o.name.slice(0, 2).toUpperCase()
                  )}
                </div>
                <span className="min-w-0 flex-1 truncate">{o.name}</span>
                {o.slug === org.slug ? (
                  <IconCheck className="text-blue-300" />
                ) : null}
              </Link>
            ))}
          </div>
          <Link
            href="/onboarding"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 border-t border-white/[0.08] px-3 py-2.5 text-sm text-kos-muted hover:bg-white/[0.045] hover:text-kos-fg"
          >
            <IconPlus /> New organization
          </Link>
        </div>
      ) : null}
    </div>
  );
}
