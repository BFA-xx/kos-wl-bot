import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { AccessError, requireOrgAccess } from "@/lib/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX = 5 * 1024 * 1024; // 5 MB

/** Upload an image to Vercel Blob and return its public URL. */
export async function POST(req: Request, { params }: { params: { org: string } }) {
  try {
    const { org } = await requireOrgAccess(params.org);
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(
        { error: "Image upload isn't enabled yet — paste an image URL instead." },
        { status: 501 },
      );
    }
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file." }, { status: 400 });
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Images only." }, { status: 400 });
    }
    if (file.size > MAX) {
      return NextResponse.json({ error: "Image must be under 5 MB." }, { status: 413 });
    }

    const safeName = file.name.replace(/[^a-z0-9._-]+/gi, "-").slice(-60);
    const blob = await put(`orgs/${org.slug}/${Date.now()}-${safeName}`, file, {
      access: "public",
      contentType: file.type,
    });
    return NextResponse.json({ url: blob.url });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("upload failed", err);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
}
