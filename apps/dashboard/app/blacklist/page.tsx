import { Shell } from "@/components/Shell";
import { PageTitle } from "@/components/ui";
import { BlacklistManager } from "@/components/BlacklistManager";

export default function BlacklistPage() {
  return (
    <Shell>
      <PageTitle
        title="Blacklist"
        subtitle="Users blocked from entering raffles. Changes apply immediately."
      />
      <BlacklistManager />
    </Shell>
  );
}
