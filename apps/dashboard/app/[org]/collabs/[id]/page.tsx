import { Suspense } from "react";
import { CollabDetail } from "@/components/CollabDetail";
import { Empty } from "@/components/ui";

export default function CollaborationDetailPage() {
  return (
    <Suspense fallback={<Empty>Loading collaboration…</Empty>}>
      <CollabDetail />
    </Suspense>
  );
}
