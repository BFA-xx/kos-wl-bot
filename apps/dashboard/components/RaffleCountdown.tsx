"use client";

import { useEffect, useMemo, useState } from "react";

export function RaffleCountdown({
  status,
  startAt,
  endAt,
}: {
  status: string;
  startAt: string;
  endAt: string;
}) {
  const target = useMemo(
    () => new Date(status === "UPCOMING" ? startAt : endAt).getTime(),
    [endAt, startAt, status],
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (status === "ENDED" || target <= now) {
    return <span>{status === "UPCOMING" ? "Opening now" : "Ended"}</span>;
  }

  const total = Math.max(0, Math.floor((target - now) / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  const parts = [
    days ? `${days}d` : null,
    days || hours ? `${hours}h` : null,
    `${minutes}m`,
    `${seconds}s`,
  ].filter(Boolean);

  return (
    <span aria-live="off" aria-label={`${status === "UPCOMING" ? "Opens" : "Ends"} in ${parts.join(" ")}`}>
      {parts.join(" ")}
    </span>
  );
}
