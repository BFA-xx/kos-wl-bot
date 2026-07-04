import { redirect } from "next/navigation";
import { AccessError, requireSuperAdmin } from "@/lib/access";

/** Server-component guard: super-admin or redirect away. Defense in depth. */
export async function guardAdmin() {
  try {
    return await requireSuperAdmin();
  } catch (err) {
    if (err instanceof AccessError) {
      if (err.status === 401) redirect("/login?next=/admin");
      redirect("/");
    }
    throw err;
  }
}
