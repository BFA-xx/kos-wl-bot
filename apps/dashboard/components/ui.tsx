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
        accent
          ? "border-blue-400/25 bg-gradient-to-br from-blue-500 to-violet-500 text-white"
          : ""
      }`}
    >
      <div
        className={`text-xs font-medium uppercase tracking-[0.18em] ${accent ? "text-white/65" : "text-kos-muted"}`}
      >
        {label}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {value}
        </div>
        {typeof trend === "number" ? (
          <span
            className={`mb-1 inline-flex items-center gap-0.5 text-xs font-medium ${
              accent
                ? "text-white/75"
                : trend >= 0
                  ? "text-emerald-400"
                  : "text-kos-muted"
            }`}
          >
            {trend >= 0 ? (
              <IconArrowUp width={12} height={12} />
            ) : (
              <IconArrowDown width={12} height={12} />
            )}
            {Math.abs(trend)}%
          </span>
        ) : null}
      </div>
      {hint ? (
        <div
          className={`mt-1 text-[11px] ${accent ? "text-white/55" : "text-kos-muted/80"}`}
        >
          {hint}
        </div>
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
  eyebrow,
  action,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-8 overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-white/[0.055] via-white/[0.025] to-transparent p-5 shadow-[0_1px_0_rgba(255,255,255,0.05)_inset] sm:flex sm:items-end sm:justify-between sm:gap-6 sm:p-6">
      <div>
        <div className="mb-2 h-1 w-10 rounded-full bg-gradient-to-r from-blue-500 to-violet-500" />
        {eyebrow ? (
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-blue-300/90">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-4xl">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-kos-muted">
            {subtitle}
          </p>
        ) : null}
      </div>
      {action ? (
        <div className="mt-5 flex shrink-0 flex-wrap gap-2 sm:mt-0">
          {action}
        </div>
      ) : null}
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
    <div className="kos-card overflow-hidden p-10 text-center text-sm text-kos-muted">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-gradient-to-br from-blue-500/15 to-violet-500/15 shadow-[0_16px_60px_-32px_rgba(59,130,246,0.9)]">
        <span className="h-2.5 w-2.5 rounded-full bg-blue-300" />
      </div>
      <div className="mx-auto max-w-md leading-6">{children}</div>
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`kos-card p-4 sm:p-5 ${className}`}>{children}</div>;
}

export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-kos-muted">
        {children}
      </h2>
      {action}
    </div>
  );
}

export function TableShell({ children }: { children: ReactNode }) {
  return (
    <div className="kos-table-wrap">
      <div className="kos-table-scroll">{children}</div>
    </div>
  );
}

export function FieldHint({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-xs leading-5 text-kos-muted">{children}</p>;
}
