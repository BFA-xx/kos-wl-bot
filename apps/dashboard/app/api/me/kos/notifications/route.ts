import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireUser } from "@/lib/access";
import { findKosIdentityForUser } from "@/lib/kos/member";
import {
  KOS_NOTIFICATION_KEYS,
  parseKosNotificationPatch,
  type KosNotificationPreferences,
} from "@/lib/kos/notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Update KOS notification preferences from the website. Writes the same row
 * Telegram's /notifications toggles, so the two surfaces never disagree.
 */
export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    const identity = await findKosIdentityForUser(user.id);
    if (!identity) {
      return NextResponse.json(
        { error: "Connect Telegram to your KOS profile first." },
        { status: 404 },
      );
    }

    const body = await req.json().catch(() => null);
    const patch = parseKosNotificationPatch(body);
    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "Send at least one known preference as a boolean." },
        { status: 400 },
      );
    }

    const saved = await prisma.kosNotificationPreference.upsert({
      where: { identityId: identity.id },
      create: { identityId: identity.id, ...patch },
      update: patch,
    });

    return NextResponse.json({
      ok: true,
      notifications: Object.fromEntries(
        KOS_NOTIFICATION_KEYS.map((key) => [key, saved[key]]),
      ) as KosNotificationPreferences,
    });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("me kos notifications failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
