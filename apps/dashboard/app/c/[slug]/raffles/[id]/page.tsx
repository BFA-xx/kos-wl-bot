import { notFound, permanentRedirect } from "next/navigation";
import { getPublicRaffle } from "@/lib/public-raffle";
import {
  parsePublicRaffleId,
  publicRafflePath,
} from "@/lib/raffle-share";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Signed-in compatibility route. The canonical public page lives at /r/:id. */
export default async function LegacyRafflePage({
  params,
}: {
  params: { slug: string; id: string };
}) {
  const id = parsePublicRaffleId(params.id);
  const data = id ? await getPublicRaffle(id) : null;
  if (!id || !data || data.organization.slug !== params.slug) notFound();
  permanentRedirect(publicRafflePath(id));
}
