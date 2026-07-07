import type { ReactNode } from "react";
import { statusClasses } from "@/lib/format";
import { IconArrowUp, IconArrowDown } from "./icons";

export function StatCard({
  label,
  value,
  trend,
  hint,
  accent,
}: {
  label: string;
  value: ReactNode;
  trend?: number | null;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`kos-card kos-card-hover overflow-hidden p-4 sm:p-5 ${
        accent ? "border-blue-400/25 bg-gradient-to-br from-blue-500 to-violet-500 text-white" : ""
      }`}
    >
      <div className={`text-xs font-medium uppercase tracking-[0.18em] ${accent ? "text-white/65" : "text-kos-muted"}`}>
        {label}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="text-2xl font-semibold tracking-tight sm:text-3xl">{value}</div>
        {typeof trend === "number" ? (
          <span
            className={`mb-1 inline-flex items-center gap-0.5 text-xs font-medium ${
              accent ? "text-white/75" : trend >= 0 ? "text-emerald-400" : "text-kos-muted"
            }`}
          >
            {trend >= 0 ? <IconArrowUp width={12} height={12} /> : <IconArrowDown width={12} height={12} />}
            {Math.abs(trend)}%
          </span>
        ) : null}
      </div>
      {hint ? (
        <div className={`mt-1 text-[11px] ${accent ? "text-white/55" : "text-kos-muted/80"}`}>{hint}</div>
      ) : null}
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
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="mb-2 h-1 w-10 rounded-full bg-gradient-to-r from-blue-500 to-violet-500" />
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-2 max-w-2xl text-sm leading-6 text-kos-muted">{subtitle}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-white/[0.08] bg-white/[0.04] p-1 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`kos-seg ${value === o.key ? "kos-seg-active" : ""}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="kos-card p-10 text-center text-sm text-kos-muted">
      <div className="mx-auto mb-4 h-10 w-10 rounded-2xl border border-white/[0.08] bg-gradient-to-br from-blue-500/15 to-violet-500/15" />
      {children}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`kos-card p-4 sm:p-5 ${className}`}>{children}</div>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-kos-muted">{children}</h2>
      {action}
    </div>
  );
}
