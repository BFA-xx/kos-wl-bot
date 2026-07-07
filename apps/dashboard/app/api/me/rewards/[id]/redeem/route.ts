import { NextResponse } from "next/server";
import { AccessError, requireUser } from "@/lib/access";
import { redeemReward } from "@/lib/points";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const user = await requireUser();
    const result = await redeemReward({ rewardId: params.id, userId: user.id });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status ?? 400 },
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("reward redeem failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
