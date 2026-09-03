"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TableShell } from "@/components/ui";

interface Row {
  identityId: string;
  displayName: string;
  telegramUsername: string | null;
  xHandle: string | null;
  xUserId: string;
  linkedAt: string | null;
  followConfirmed: boolean;
}

export function XLinksTable({ links }: { links: Row[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function unlink(row: Row) {
    const label = row.xHandle ? `@${row.xHandle}` : row.xUserId;
    if (
      !confirm(
        `Unlink ${label} from ${row.displayName}?\n\nTheir confirmed follow is cleared and they must connect X again to finish onboarding. The X account becomes available to another member.`,
      )
    )
      return;
    setBusy(row.identityId);
    setMsg(null);
    const res = await fetch(`/api/admin/x-links/${row.identityId}`, {
      method: "DELETE",
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    setMsg(res.ok ? `Unlinked ${label}.` : (body.error ?? "Couldn't unlink."));
    if (res.ok) router.refresh();
  }

  return (
    <>
      {msg && <p className="mb-3 text-sm text-kos-muted">{msg}</p>}
      <TableShell>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-kos-muted">
              <th className="py-2">Member</th>
              <th className="py-2">Telegram</th>
              <th className="py-2">X account</th>
              <th className="py-2">Follow</th>
              <th className="py-2">Linked</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {links.map((row) => (
              <tr key={row.identityId} className="border-t border-kos-border">
                <td className="py-2">{row.displayName}</td>
                <td className="py-2 text-kos-muted">
                  {row.telegramUsername ? `@${row.telegramUsername}` : "—"}
                </td>
                <td className="py-2">
                  {row.xHandle ? (
                    <a
                      className="text-kos-accent"
                      href={`https://x.com/${row.xHandle}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      @{row.xHandle}
                    </a>
                  ) : (
                    row.xUserId
                  )}
                </td>
                <td className="py-2">
                  {row.followConfirmed ? (
                    <span className="text-emerald-400">Confirmed</span>
                  ) : (
                    <span className="text-kos-muted">Not yet</span>
                  )}
                </td>
                <td className="py-2 text-kos-muted">
                  {row.linkedAt ? new Date(row.linkedAt).toLocaleDateString() : "—"}
                </td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    onClick={() => unlink(row)}
                    disabled={busy === row.identityId}
                    className="rounded-lg border border-kos-border px-3 py-1 text-xs text-amber-400 disabled:opacity-50"
                  >
                    {busy === row.identityId ? "Unlinking…" : "Unlink"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>
    </>
  );
}
