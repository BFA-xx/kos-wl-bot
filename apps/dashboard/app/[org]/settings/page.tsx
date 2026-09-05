import { redirect } from "next/navigation";
import { AccessError, requireOrgAccess } from "@/lib/access";
import { PageTitle, Card, SectionTitle } from "@/components/ui";
import { BrandingForm } from "@/components/BrandingForm";
import { ServersManager } from "@/components/ServersManager";
import { RoleWeightsManager } from "@/components/RoleWeightsManager";
import { RaffleChannelDefaults } from "@/components/RaffleChannelDefaults";
import { VerificationManager } from "@/components/VerificationManager";
import { TelegramCommunityManager } from "@/components/TelegramCommunityManager";
import { GoogleSheetsManager } from "@/components/GoogleSheetsManager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function SettingsPage({
  params,
}: {
  params: { org: string };
}) {
  let org;
  try {
    ({ org } = await requireOrgAccess(params.org));
  } catch (err) {
    if (err instanceof AccessError) redirect("/");
    throw err;
  }

  return (
    <>
      <PageTitle
        title="Settings"
        subtitle="Branding, connected communities, verification, and raffle defaults."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>Branding</SectionTitle>
          <BrandingForm
            initial={{
              name: org.name,
              logoUrl: org.logoUrl,
              bannerUrl: org.bannerUrl,
              description: org.description,
              xHandle: org.xHandle,
            }}
          />
        </Card>

        <Card>
          <SectionTitle>Discord servers</SectionTitle>
          <ServersManager />
        </Card>

        <Card className="lg:col-span-2">
          <SectionTitle>Default channels</SectionTitle>
          <RaffleChannelDefaults />
        </Card>

        <Card className="lg:col-span-2">
          <SectionTitle>Telegram communities</SectionTitle>
          <TelegramCommunityManager />
        </Card>

        <Card className="lg:col-span-2">
          <SectionTitle>Google Sheets</SectionTitle>
          <GoogleSheetsManager />
        </Card>

        <Card className="lg:col-span-2">
          <SectionTitle>KOS member verification</SectionTitle>
          <VerificationManager />
        </Card>

        <Card className="lg:col-span-2">
          <SectionTitle>Weighted raffle roles</SectionTitle>
          <RoleWeightsManager />
        </Card>
      </div>
    </>
  );
}
