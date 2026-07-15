import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrgAccess, withAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export const GET = withAccess(async (req, { params }) => {
  const { org } = await requireOrgAccess(params.org, PERMISSIONS.COLLAB_VIEW);
  const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, 100) ?? "";
  const partners = await prisma.collaborationPartner.findMany({
    where: {
      organizationId: org.id,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { chain: { contains: q, mode: "insensitive" as const } },
              { category: { contains: q, mode: "insensitive" as const } },
              {
                contacts: {
                  some: { name: { contains: q, mode: "insensitive" as const } },
                },
              },
            ],
          }
        : {}),
    },
    include: {
      contacts: { orderBy: { updatedAt: "desc" }, take: 5 },
      collaborations: {
        select: {
          id: true,
          status: true,
          projectName: true,
          updatedAt: true,
          raffles: {
            select: {
              raffle: { select: { walletChains: true } },
            },
          },
        },
        orderBy: { updatedAt: "desc" },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 250,
  });
  return NextResponse.json({
    partners: partners.map((partner) => {
      const decided = partner.collaborations.filter((item) =>
        ["COMPLETED", "CANCELLED"].includes(item.status),
      );
      const completed = decided.filter(
        (item) => item.status === "COMPLETED",
      ).length;
      return {
        ...partner,
        responseRate: decided.length
          ? Math.round((completed / decided.length) * 100)
          : null,
      };
    }),
  });
});
