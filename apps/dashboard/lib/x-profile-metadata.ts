import { normalizeXHandle, xProfileUrl } from "./organization-social";

export interface XProfileMetadata {
  displayName: string;
  username: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  bio: string | null;
  websiteUrl: string | null;
  verified: boolean;
  profileUrl: string;
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/&#(\d+);/gu, (_match, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function metaContent(
  html: string,
  attribute: "name" | "property" | "itemProp",
  key: string,
): string | null {
  const safeKey = escapeRegExp(key);
  const patterns = [
    new RegExp(
      `<meta[^>]*${attribute}=["']${safeKey}["'][^>]*content=["']([^"']*)["'][^>]*>`,
      "iu",
    ),
    new RegExp(
      `<meta[^>]*content=["']([^"']*)["'][^>]*${attribute}=["']${safeKey}["'][^>]*>`,
      "iu",
    ),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern)?.[1];
    if (match) return decodeHtml(match);
  }
  return null;
}

function safeExternalUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export async function fetchXProfileMetadata(
  input: unknown,
): Promise<XProfileMetadata | null> {
  const username = normalizeXHandle(input);
  if (!username) return null;

  const response = await fetch(xProfileUrl(username), {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent":
        "Mozilla/5.0 (compatible; KOSCollabHub/1.0; +https://koslabs.app)",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(8_000),
    next: { revalidate: 21_600 },
  });
  if (!response.ok) return null;

  const html = await response.text();
  const profileStart = html.indexOf('itemType="https://schema.org/Person"');
  const profileHtml = profileStart >= 0 ? html.slice(profileStart) : html;
  const canonicalUsername =
    metaContent(html, "property", "profile:username") ?? username;
  const displayName =
    metaContent(html, "property", "profile:first_name") ??
    metaContent(html, "name", "author") ??
    canonicalUsername;
  const avatarUrl = safeExternalUrl(metaContent(html, "property", "og:image"));
  const bannerUrl = safeExternalUrl(
    profileHtml.match(
      /href=["'][^"']*\/header_photo["'][^>]*>\s*<img[^>]*src=["']([^"']+)["']/iu,
    )?.[1] ?? null,
  );
  const websiteUrl = safeExternalUrl(
    metaContent(profileHtml, "itemProp", "sameAs"),
  );

  return {
    displayName,
    username: canonicalUsername.replace(/^@/u, ""),
    avatarUrl:
      avatarUrl?.replace(
        /_(?:normal|200x200)(\.[a-z0-9]+)(?:\?.*)?$/iu,
        "_400x400$1",
      ) ?? null,
    bannerUrl,
    bio:
      metaContent(html, "name", "description") ??
      metaContent(profileHtml, "itemProp", "description"),
    websiteUrl,
    verified:
      /is_blue_verified:!0/iu.test(html) ||
      /verified:!0/iu.test(html) ||
      /data-icon=["']icon-verified/iu.test(html),
    profileUrl: xProfileUrl(canonicalUsername),
  };
}
