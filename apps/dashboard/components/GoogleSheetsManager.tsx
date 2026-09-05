"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { useCan, useOrg } from "@/lib/org-context";
import { PERMISSIONS } from "@/lib/permissions";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface GoogleStatus {
  configured: boolean;
  connection: {
    email: string;
    editorEmails: string[];
    hasDriveAccess: boolean;
    connectedAt: string;
  } | null;
}

const CALLBACK_MESSAGES: Record<string, string> = {
  connected: "Google account connected.",
  cancelled: "Google sign-in was cancelled.",
  missing_scope:
    "Google signed you in but did not grant permission to create files, so no sheet could be built. Connect again and tick the Google Drive permission — and check drive.file is listed under Data Access in the Cloud console.",
  invalid_state:
    "That sign-in link expired before it came back. Start the connection again.",
  no_code: "Google did not return an authorization code.",
  exchange_failed:
    "Google rejected the sign-in. If you have connected before, remove KOS Raffles from your Google account's third-party access and try again.",
  forbidden:
    "You do not have permission to change this organization's settings.",
  not_configured:
    "Google Sheets is not configured on this server — GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are unset.",
  error: "Something went wrong connecting Google.",
};

/**
 * Connect the Google account that owns the winner handover sheets, and name
 * the accounts allowed to edit them. Everyone else opening a sheet link gets
 * read-only.
 */
export function GoogleSheetsManager() {
  const { slug } = useOrg();
  const canEdit = useCan(PERMISSIONS.SETTINGS_EDIT);
  const searchParams = useSearchParams();
  const { data, mutate } = useSWR<GoogleStatus>(
    `/api/${slug}/integrations/google`,
    fetcher,
  );
  const [editors, setEditors] = useState("");
  const [busy, setBusy] = useState<"save" | "disconnect" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const connection = data?.connection ?? null;

  useEffect(() => {
    setEditors((connection?.editorEmails ?? []).join("\n"));
  }, [connection?.editorEmails]);

  useEffect(() => {
    const status = searchParams?.get("google");
    if (status) setMsg(CALLBACK_MESSAGES[status] ?? CALLBACK_MESSAGES.error!);
  }, [searchParams]);

  async function saveEditors() {
    setBusy("save");
    setMsg(null);
    const res = await fetch(`/api/${slug}/integrations/google`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        editorEmails: editors
          .split(/[\n,;]+/u)
          .map((value) => value.trim())
          .filter(Boolean),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    setMsg(
      res.ok ? "Editors saved." : (body.error ?? "Couldn't save editors."),
    );
    if (res.ok) void mutate();
  }

  async function disconnect() {
    if (
      !confirm(
        "Disconnect Google? Sheets already created stay in that account's Drive and keep working, but no new ones can be created until you reconnect.",
      )
    ) {
      return;
    }
    setBusy("disconnect");
    setMsg(null);
    const res = await fetch(`/api/${slug}/integrations/google`, {
      method: "DELETE",
    });
    setBusy(null);
    setMsg(res.ok ? "Google disconnected." : "Couldn't disconnect.");
    void mutate();
  }

  if (!data) {
    return <p className="text-sm text-kos-muted">Loading…</p>;
  }

  if (!data.configured) {
    return (
      <p className="text-sm text-kos-muted">
        Google Sheets is not configured on this server. Set{" "}
        <code className="text-kos-text">GOOGLE_CLIENT_ID</code> and{" "}
        <code className="text-kos-text">GOOGLE_CLIENT_SECRET</code>, then
        redeploy.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-kos-muted">
        Winner lists open as a Google Sheet instead of downloading. Sheets are
        created in the connected account&apos;s Drive, so that account keeps
        ownership. Anyone with the link can view; only the accounts below can
        edit.
      </p>

      {connection && !connection.hasDriveAccess ? (
        <p className="rounded-2xl border border-amber-400/25 bg-amber-500/[0.08] px-4 py-3 text-sm leading-6 text-amber-200">
          <strong>{connection.email}</strong> is signed in but did not grant
          permission to create files, so winner sheets cannot be built. Click
          Reconnect and tick the Google Drive permission on the consent screen.
        </p>
      ) : null}

      {connection ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
          <div className="min-w-0">
            <div className="truncate font-medium">{connection.email}</div>
            <div className="mt-1 text-xs text-kos-muted">
              Connected {new Date(connection.connectedAt).toLocaleString()}
            </div>
          </div>
          {canEdit ? (
            <div className="flex shrink-0 gap-2">
              <a
                className="kos-btn"
                href={`/api/${slug}/integrations/google/start`}
              >
                Reconnect
              </a>
              <button
                className="kos-btn"
                onClick={disconnect}
                disabled={busy !== null}
              >
                {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
          ) : null}
        </div>
      ) : canEdit ? (
        <a
          className="kos-btn-primary inline-flex"
          href={`/api/${slug}/integrations/google/start`}
        >
          Connect Google account
        </a>
      ) : (
        <p className="text-sm text-kos-muted">
          No Google account is connected. An admin can connect one here.
        </p>
      )}

      {connection ? (
        <div>
          <label className="kos-label" htmlFor="google-editors">
            Google accounts that can edit (one per line)
          </label>
          <textarea
            id="google-editors"
            className="kos-input min-h-[110px] font-mono text-xs"
            placeholder={"teammate@gmail.com\npartner@project.xyz"}
            value={editors}
            disabled={!canEdit}
            onChange={(event) => setEditors(event.target.value)}
          />
          <p className="mt-2 text-xs leading-5 text-kos-muted">
            These must be Google accounts — a Gmail address, or a Workspace
            address. Editors are applied when a sheet is created or rewritten,
            so add people before you hand a link over.
          </p>
          {canEdit ? (
            <button
              className="kos-btn mt-2"
              onClick={saveEditors}
              disabled={busy !== null}
            >
              {busy === "save" ? "Saving…" : "Save editors"}
            </button>
          ) : null}
        </div>
      ) : null}

      {msg ? <p className="text-sm text-kos-muted">{msg}</p> : null}
    </div>
  );
}
