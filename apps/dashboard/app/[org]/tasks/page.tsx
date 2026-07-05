"use client";

import { PageTitle } from "@/components/ui";
import { TasksManager } from "@/components/TasksManager";

export default function TasksPage() {
  return (
    <>
      <PageTitle
        title="Tasks"
        subtitle="Reusable verification tasks — attach them to raffles to gate entry."
      />
      <TasksManager />
    </>
  );
}
