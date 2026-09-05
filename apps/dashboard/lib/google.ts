import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";

/**
 * Minimal Google client for the winner-sheet handover.
 *
 * Four calls are all this feature needs — refresh a token, create a
 * spreadsheet, write cells, share the file — so they are issued directly
 * against the REST endpoints rather than pulling in `googleapis`, which is a
 * ~50MB dependency on a Vercel function that would sit unused.
 *
 * Auth is per-organization OAuth: a team member connects a Google account
 * once, and every sheet is created in *that* account's Drive. Service
 * accounts are not an option here — since 15 April 2025 they have no Drive
 * storage quota of their own and can only write into a Workspace shared
 * drive.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";

/**
 * `drive.file` is deliberately the only Drive scope: it grants access to files
 * this app created and nothing else in the user's Drive. It also covers the
 * Sheets API calls below, so no broader `spreadsheets` scope is needed.
 */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "openid",
  "email",
] as const;

export class GoogleError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "GoogleError";
  }
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * The client id and secret alone. Refreshing a token needs no redirect URI,
 * and asking for one would mean inventing an origin on code paths that have
 * no request to take it from.
 */
export function googleClientCredentials(): {
  clientId: string;
  clientSecret: string;
} | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** OAuth credentials, or null when the integration has not been configured. */
export function googleOAuthConfig(origin: string): GoogleOAuthConfig | null {
  const credentials = googleClientCredentials();
  if (!credentials) return null;
  const configured = process.env.GOOGLE_REDIRECT_URI?.trim();
  return {
    ...credentials,
    redirectUri: configured || `${origin}/api/integrations/google/callback`,
  };
}

/** Consent URL. `prompt=consent` is required to be handed a refresh token. */
export function googleConsentUrl(
  config: GoogleOAuthConfig,
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  expires_in?: number;
}

async function tokenRequest(
  body: Record<string, string>,
): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const detail =
      typeof json.error_description === "string"
        ? json.error_description
        : typeof json.error === "string"
          ? json.error
          : "Google rejected the token request.";
    throw new GoogleError(res.status, detail);
  }
  return json as unknown as TokenResponse;
}

export interface ExchangedCode {
  refreshToken: string;
  accessToken: string;
  scope: string;
  googleUserId: string;
  googleEmail: string;
}

/** Swap an authorization code for a refresh token plus the account identity. */
export async function exchangeGoogleCode(
  config: GoogleOAuthConfig,
  code: string,
): Promise<ExchangedCode> {
  const token = await tokenRequest({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });
  if (!token.refresh_token) {
    throw new GoogleError(
      400,
      "Google did not return a refresh token. Remove KOS Raffles from your Google account's third-party access and connect again.",
    );
  }
  const identity = decodeIdToken(token.id_token);
  if (!identity) {
    throw new GoogleError(400, "Google did not return an account identity.");
  }
  return {
    refreshToken: token.refresh_token,
    accessToken: token.access_token,
    scope: token.scope ?? GOOGLE_SCOPES.join(" "),
    ...identity,
  };
}

/**
 * Read `sub` and `email` out of the id token. The token arrives over TLS
 * straight from Google's token endpoint in exchange for our client secret, so
 * the payload is trusted without a signature check — it was never handled by
 * the browser.
 */
function decodeIdToken(
  idToken: string | undefined,
): { googleUserId: string; googleEmail: string } | null {
  const payload = idToken?.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { sub?: unknown; email?: unknown };
    if (typeof json.sub !== "string" || typeof json.email !== "string") {
      return null;
    }
    return { googleUserId: json.sub, googleEmail: json.email };
  } catch {
    return null;
  }
}

/**
 * A short-lived access token for an org's connected account. Refresh tokens
 * stay revocable from the user's Google account page, so a revoked connection
 * surfaces here as a 400 — reported as a reconnect prompt, not a 500.
 */
export async function accessTokenForOrg(
  organizationId: string,
): Promise<{ accessToken: string; connectionId: string; email: string }> {
  const connection = await prisma.googleConnection.findUnique({
    where: { organizationId },
  });
  if (!connection) {
    throw new GoogleError(
      409,
      "No Google account is connected. Connect one in Settings → Google Sheets.",
    );
  }
  const credentials = googleClientCredentials();
  if (!credentials) {
    throw new GoogleError(
      503,
      "Google Sheets is not configured on this server.",
    );
  }
  let token: TokenResponse;
  try {
    token = await tokenRequest({
      refresh_token: decryptSecret(connection.refreshToken),
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      grant_type: "refresh_token",
    });
  } catch (err) {
    if (err instanceof GoogleError && err.status < 500) {
      throw new GoogleError(
        409,
        `Google access for ${connection.googleEmail} has expired or been revoked. Reconnect the account in Settings → Google Sheets.`,
      );
    }
    throw err;
  }
  return {
    accessToken: token.access_token,
    connectionId: connection.id,
    email: connection.googleEmail,
  };
}

async function googleFetch<T>(
  url: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const error = json.error as { message?: string } | undefined;
    throw new GoogleError(
      res.status,
      error?.message ?? `Google API error (${res.status}).`,
    );
  }
  return json as T;
}

export interface SheetTab {
  title: string;
  /** Row-major cell values. Row 0 is written at A1 of the tab. */
  rows: (string | number)[][];
  /** Rows to hold in place when the reader scrolls. */
  frozenRows?: number;
  /** Per-column widths in pixels, applied left to right. */
  columnWidths?: number[];
}

/** Create a spreadsheet with the given tabs and return its id and URL. */
export async function createSpreadsheet(
  accessToken: string,
  title: string,
  tabs: SheetTab[],
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  const created = await googleFetch<{
    spreadsheetId: string;
    spreadsheetUrl: string;
    sheets: { properties: { sheetId: number; title: string } }[];
  }>(SHEETS_API, accessToken, {
    method: "POST",
    body: JSON.stringify({
      properties: { title },
      sheets: tabs.map((tab, index) => ({
        properties: {
          sheetId: index,
          title: tab.title,
          index,
          gridProperties: {
            frozenRowCount: tab.frozenRows ?? 0,
            rowCount: Math.max(tab.rows.length + 50, 100),
            columnCount: Math.max(
              ...tab.rows.map((row) => row.length),
              tab.columnWidths?.length ?? 1,
              1,
            ),
          },
        },
      })),
    }),
  });
  return {
    spreadsheetId: created.spreadsheetId,
    spreadsheetUrl: created.spreadsheetUrl,
  };
}

/** Replace every tab's contents, then re-apply formatting. */
export async function writeSpreadsheet(
  accessToken: string,
  spreadsheetId: string,
  tabs: SheetTab[],
  requests: unknown[],
): Promise<void> {
  // Clear first: a re-sync that produced fewer rows must not leave the tail of
  // the previous list sitting under the new one.
  await googleFetch(
    `${SHEETS_API}/${spreadsheetId}/values:batchClear`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        ranges: tabs.map((tab) => `'${tab.title.replace(/'/gu, "''")}'`),
      }),
    },
  );
  await googleFetch(
    `${SHEETS_API}/${spreadsheetId}/values:batchUpdate`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        valueInputOption: "RAW",
        data: tabs.map((tab) => ({
          range: `'${tab.title.replace(/'/gu, "''")}'!A1`,
          majorDimension: "ROWS",
          values: tab.rows,
        })),
      }),
    },
  );
  if (requests.length) {
    await googleFetch(
      `${SHEETS_API}/${spreadsheetId}:batchUpdate`,
      accessToken,
      {
        method: "POST",
        body: JSON.stringify({ requests }),
      },
    );
  }
}

/** The tab ids Google assigned, keyed by tab title. */
export async function spreadsheetTabIds(
  accessToken: string,
  spreadsheetId: string,
): Promise<Map<string, number>> {
  const meta = await googleFetch<{
    sheets: { properties: { sheetId: number; title: string } }[];
  }>(
    `${SHEETS_API}/${spreadsheetId}?fields=sheets.properties.sheetId,sheets.properties.title`,
    accessToken,
  );
  return new Map(
    meta.sheets.map((sheet) => [
      sheet.properties.title,
      sheet.properties.sheetId,
    ]),
  );
}

/**
 * Share the sheet: read-only for anyone holding the link, edit rights for the
 * org's named Google accounts. Editor grants are best-effort — a typo'd or
 * non-Google address must not sink the whole handover — and the failures are
 * returned so the caller can surface them.
 */
export async function shareSpreadsheet(
  accessToken: string,
  spreadsheetId: string,
  editorEmails: readonly string[],
): Promise<{ failedEditors: string[] }> {
  try {
    await googleFetch(
      `${DRIVE_API}/${spreadsheetId}/permissions?sendNotificationEmail=false`,
      accessToken,
      {
        method: "POST",
        body: JSON.stringify({ role: "reader", type: "anyone" }),
      },
    );
  } catch (err) {
    // A rewrite re-grants a link that is already shared. Rather than guess at
    // Drive's error shape for that case, confirm the grant is there and carry
    // on; anything else is a real failure and the sheet must not be handed
    // over believing it is readable.
    if (!(await hasAnyoneReader(accessToken, spreadsheetId))) throw err;
  }

  const failedEditors: string[] = [];
  for (const email of editorEmails) {
    try {
      await googleFetch(
        `${DRIVE_API}/${spreadsheetId}/permissions?sendNotificationEmail=false`,
        accessToken,
        {
          method: "POST",
          body: JSON.stringify({
            role: "writer",
            type: "user",
            emailAddress: email,
          }),
        },
      );
    } catch {
      failedEditors.push(email);
    }
  }
  return { failedEditors };
}

/** Whether link sharing is already in place on the file. */
async function hasAnyoneReader(
  accessToken: string,
  spreadsheetId: string,
): Promise<boolean> {
  try {
    const listed = await googleFetch<{
      permissions: { type?: string; role?: string }[];
    }>(
      `${DRIVE_API}/${spreadsheetId}/permissions?fields=permissions(type,role)`,
      accessToken,
    );
    return listed.permissions.some(
      (permission) =>
        permission.type === "anyone" &&
        (permission.role === "reader" || permission.role === "writer"),
    );
  } catch {
    return false;
  }
}
