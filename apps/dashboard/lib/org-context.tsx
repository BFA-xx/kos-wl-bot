"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Permission } from "@/lib/permissions";

export interface OrgSummary {
  slug: string;
  name: string;
  logoUrl: string | null;
}

export interface OrgClientContext {
  slug: string;
  name: string;
  logoUrl: string | null;
  isOwner: boolean;
  isSuperAdmin: boolean;
  permissions: string[];
  user: { id: string; name: string; avatarUrl: string | null };
  /** All orgs the user can switch between. */
  orgs: OrgSummary[];
}

const Ctx = createContext<OrgClientContext | null>(null);

export function OrgProvider({
  value,
  children,
}: {
  value: OrgClientContext;
  children: ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOrg(): OrgClientContext {
  const c = useContext(Ctx);
  if (!c) throw new Error("useOrg must be used within an OrgProvider");
  return c;
}

/** Permission check for gating UI (owner passes everything). */
export function useCan(permission: Permission): boolean {
  const c = useOrg();
  return c.isOwner || c.permissions.includes(permission);
}
