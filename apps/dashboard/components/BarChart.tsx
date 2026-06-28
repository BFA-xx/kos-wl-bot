"use client";

export interface BarPoint {
  label: string;
  value: number;
}

export function BarChart({ data }: { data: BarPoint[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (data.length === 0) {
    return <div className="flex h-48 items-center justify-center text-sm text-kos-muted">No data yet.</div>;
  }
  return (
    <div className="flex h-48 items-end gap-1.5 sm:gap-2.5">
      {data.map((d, i) => {
        const h = Math.max(Math.round((d.value / max) * 100), 2);
        const last = i === data.length - 1;
        return (
          <div key={i} className="group flex flex-1 flex-col items-center gap-2">
            <div className="relative flex w-full flex-1 items-end">
              <div className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-full rounded-md border border-kos-border bg-kos-card px-1.5 py-0.5 text-[10px] text-kos-fg opacity-0 transition-opacity group-hover:opacity-100">
                {d.value}
              </div>
              <div
                style={{ height: `${h}%` }}
                className={`w-full rounded-t-lg transition-all duration-300 ${
                  last ? "bg-kos-fg" : "bg-kos-fg/15 group-hover:bg-kos-fg/30"
                }`}
              />
            </div>
            <span className="truncate text-[10px] text-kos-muted">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}
