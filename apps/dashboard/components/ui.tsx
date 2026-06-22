import type { ReactNode } from "react";
import { statusClasses } from "@/lib/format";

export function StatCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="kos-card p-4">
      <div className="text-xs uppercase tracking-wide text-kos-grey">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`kos-badge ${statusClasses(status)}`}>{status}</span>;
}

export function PageTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-kos-grey">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="kos-card p-10 text-center text-sm text-kos-grey">{children}</div>
  );
}
