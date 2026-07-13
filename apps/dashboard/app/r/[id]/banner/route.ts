import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const raffleId = Number(params.id);
  if (!Number.isSafeInteger(raffleId) || raffleId < 1) {
    return new Response("Not found", { status: 404 });
  }
  const asset = await prisma.raffleBannerAsset.findUnique({
    where: { raffleId },
    select: { contentType: true, byteLength: true, data: true },
  });
  if (!asset) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(asset.data), {
    headers: {
      "cache-control": "public, max-age=31536000, immutable",
      "content-length": String(asset.byteLength),
      "content-type": asset.contentType,
      "x-content-type-options": "nosniff",
    },
  });
}
