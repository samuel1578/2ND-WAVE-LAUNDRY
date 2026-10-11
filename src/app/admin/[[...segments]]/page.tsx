import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AdminApp } from "@/components/admin/admin-app";
import { getCurrentAdmin } from "@/lib/auth/admin";
import { resolveAdminRouteAccess } from "@/lib/auth/permissions";
import { isPublicAdminPath, safeAdminPath } from "@/lib/auth/redirect";
import { demoMode } from "@/lib/demo-mode";
import { supabaseConfig, supabaseConfigMessage } from "@/lib/supabase/config";

export const metadata: Metadata = {
  title: "Administration",
  robots: { index: false, follow: false },
};

// Authenticated HTML is never cached; the proxy also marks every /admin
// response private and non-storable.
export const dynamic = "force-dynamic";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ segments?: string[] }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { segments = [] } = await params;
  const query = await searchParams;
  const pathname = "/admin" + (segments.length ? `/${segments.join("/")}` : "");
  // Safe, non-secret explanation shown when production auth is not configured.
  const configError = supabaseConfig.ok
    ? null
    : supabaseConfigMessage(supabaseConfig.reason);

  if (isPublicAdminPath(pathname)) {
    // A recovery session is only useful to an active administrator; anyone else
    // sees the "link unavailable" state instead of a form that cannot succeed.
    const recoveryReady =
      segments[0] === "set-password" ? (await getCurrentAdmin()) !== null : false;
    return (
      <AdminApp
        segments={segments}
        session={null}
        state={demoMode ? query.state : undefined}
        next={safeAdminPath(query.next)}
        configError={configError}
        recoveryReady={recoveryReady}
      />
    );
  }

  // Independently verified on the server for every protected admin render. The
  // proxy redirect is a convenience, not the authorisation boundary.
  const admin = await getCurrentAdmin();

  if (!admin && !demoMode)
    redirect(`/admin/login?next=${encodeURIComponent(safeAdminPath(pathname))}`);

  /**
   * Sprint 1B authorisation. The role comes from the verified session plus the
   * database profile only — never from the URL, query string, cookie value or
   * any client-supplied role. Denials are resolved here so no protected module
   * renders, and so forbidden content is never fetched or sent to the browser.
   */
  let denial: "forbidden" | "unknown" | undefined;
  if (admin) {
    const access = resolveAdminRouteAccess(admin.role, pathname);
    if (access.kind === "redirect") redirect(access.to);
    else if (access.kind === "forbidden") denial = "forbidden";
    else if (access.kind === "unknown") denial = "unknown";
  }

  return (
    <AdminApp
      segments={segments}
      session={admin}
      state={demoMode ? query.state : undefined}
      next="/admin"
      notice={query.notice}
      configError={configError}
      denial={denial}
    />
  );
}
