import { NextResponse, type NextRequest } from "next/server";
import { simulateRaffleCost } from "@kos/db";
import { guardAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Pre-flight cost estimate. Read-only: nothing here touches the X API. */
export async function POST(req: NextRequest) {
  await guardAdmin();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const int = (key: string, fallback = 0) => {
    const value = Number(body[key]);
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
  };

  return NextResponse.json(
    simulateRaffleCost({
      participants: Math.min(int("participants"), 1_000_000),
      followTasks: int("followTasks"),
      likeTasks: int("likeTasks"),
      repostTasks: int("repostTasks"),
      winnerCount: int("winnerCount"),
    }),
  );
}
