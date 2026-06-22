import { NextResponse } from "next/server";
import { callBot } from "@/lib/bot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const id = Number(params.id);
  const result = await callBot(`/internal/raffles/${id}/end`, { actorId: "dashboard" });
  return NextResponse.json(result.body, { status: result.status });
}
