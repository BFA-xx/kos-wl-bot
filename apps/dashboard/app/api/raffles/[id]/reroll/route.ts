import { NextResponse, type NextRequest } from "next/server";
import { callBot } from "@/lib/bot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = Number(params.id);
  const body = await req.json().catch(() => ({}));
  const result = await callBot(`/internal/raffles/${id}/reroll`, {
    mode: body.mode ?? "all",
    userIds: body.userIds,
    count: body.count,
    actorId: "dashboard",
  });
  return NextResponse.json(result.body, { status: result.status });
}
