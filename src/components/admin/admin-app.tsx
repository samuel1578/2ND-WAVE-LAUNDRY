"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  MessageSquare,
  Clock,
  CheckCircle2,
  ShieldAlert,
} from "lucide-react";
import { demoMode } from "@/lib/content";
import {
  requestAdminPasswordReset,
  signInAdmin,
  updateAdminPassword,
} from "@/lib/auth/actions";
import { isFrameworkNavigation } from "@/lib/auth/client-navigation";
import {
  adminNavigationFor,
  defaultLandingFor,
  resolveAdminRoute,
  type AdminRouteDefinition,
} from "@/lib/auth/permissions";
import { roleLabel, type AdminIdentity } from "@/lib/auth/roles";
import { dataBackendNotice } from "@/lib/features";
import { useDemoStore } from "@/lib/mock-store";
import { statusLabel } from "@/lib/rules";
import { AdminSidebar, Logo } from "@/components/shell";
import { Empty, Heading, Skeleton } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { BrandText } from "@/components/brand-text";
import { Notice, Submit, TextField } from "@/components/forms/controls";
import { Bookings } from "./bookings";
import { Enquiries, NewsletterAdmin } from "./leads";
import { ContentAdmin } from "./content-admin";
import { ReviewsAdmin } from "./reviews";
import { MediaAdmin } from "./media-admin";
import { SettingsAdmin } from "./settings";
import { StaffAdmin } from "./staff-manager";

const AUTH_ROUTES = ["login", "reset-password", "set-password"];

export function AdminApp({
  segments,
  session,
  state,
  next = "/admin",
  notice,
  configError,
  denial,
  recoveryReady = false,
}: {
  segments: string[];
  session: AdminIdentity | null;
  state?: string;
  next?: string;
  notice?: string;
  configError: string | null;
  /** Server-side authorisation result for this route (Sprint 1B). */
  denial?: "forbidden" | "unknown";
  recoveryReady?: boolean;
}) {
  const router = useRouter();
  const [demoAllowed, setDemoAllowed] = useState<boolean | null>(null);
  const route = segments[0] || "";
  useEffect(() => {
    setDemoAllowed(
      demoMode && sessionStorage.getItem("wave-demo-session") === "active",
    );
  }, []);
  if (AUTH_ROUTES.includes(route))
    return (
      <main id="main" className="container public-main">
        <Auth
          mode={route}
          state={state}
          next={next}
          configError={configError}
          recoveryReady={recoveryReady}
        />
      </main>
    );

  // No verified administrator session. Demo mode keeps the isolated preview
  // available; without it the demo flag grants nothing and the page is empty.
  if (!session) {
    if (demoAllowed === null)
      return (
        <main id="main" className="container public-main">
          <Skeleton />
        </main>
      );
    if (!demoAllowed)
      return (
        <main id="main" className="container public-main">
          <Empty
            title="Admin Sign In"
            body={
              configError ??
              "Sign in with an administrator account. Access is limited to invited staff."
            }
          >
            <Link className="button" href="/admin/login">
              Sign In
            </Link>
          </Empty>
        </main>
      );
  }

  // The demo workspace is an isolated preview: it renders the full console for
  // design review and never reaches a database-backed operation. A real session
  // always uses its own database-resolved role.
  const role = session?.role ?? (demoAllowed ? "full_admin" : null);
  const navigation = adminNavigationFor(role);
  const landing = defaultLandingFor(role);
  const requestedHref =
    "/admin" + (segments.length ? `/${segments.join("/")}` : "");
  const requested = resolveAdminRoute(requestedHref);
  const requestedLabel =
    requested.kind === "known" ? requested.route.label : null;
  // Honest availability state: authenticated access does not mean the business
  // data layer is connected (Sprint 1B does not persist anything).
  const dataNotice = session ? dataBackendNotice() : null;

  let content: React.ReactNode;
  if (denial) {
    // Denied by the server before any module data was resolved or rendered.
    content =
      denial === "forbidden" ? (
        <Empty
          title="Access denied"
          body={
            requestedLabel
              ? `Your administrator role does not include ${requestedLabel}. Ask a Full Admin if you need access to it.`
              : "Your administrator role does not include this area of the console."
          }
        >
          <Link className="button" href={landing}>
            Return to {routeLabelFor(landing)}
          </Link>
        </Empty>
      ) : (
        <Empty
          title="Record not found"
          body="This record may no longer be available."
        />
      );
  } else {
    const known = [
      "",
      "bookings",
      "enquiries",
      "reviews",
      "newsletter",
      "content",
      "media",
      "settings",
      "staff",
    ];
    content =
      route === "bookings" ? (
        <Bookings id={segments[1]} state={state} />
      ) : route === "enquiries" ? (
        <Enquiries id={segments[1]} state={state} />
      ) : route === "reviews" ? (
        <ReviewsAdmin state={state} />
      ) : route === "newsletter" ? (
        <NewsletterAdmin state={state} />
      ) : route === "content" ? (
        <ContentAdmin segments={segments.slice(1)} state={state} />
      ) : route === "media" ? (
        <MediaAdmin id={segments[1]} state={state} />
      ) : route === "settings" ? (
        <SettingsAdmin />
      ) : route === "staff" ? (
        // Sprint 1C. The server has already authorised this route through
        // `resolveAdminRouteAccess` (staff.manage), so an Operational Admin never
        // receives this branch: they get the forbidden state instead.
        <StaffAdmin viewerId={session?.userId} />
      ) : route === "" ? (
        <Dashboard
          empty={state === "empty"}
          modules={navigation.filter((item) => item.key !== "dashboard")}
        />
      ) : (
        <Empty title="Record not found" />
      );
    if (state === "loading")
      content = <Skeleton count={route === "content" ? 5 : 6} />;
    if (state === "error")
      content = (
        <Empty
          title="This page isn’t available right now."
          body="Please try again."
        >
          <button
            className="button"
            onClick={() => router.replace("/admin/" + segments.join("/"))}
          >
            Try Again
          </button>
        </Empty>
      );
    if (state === "access-denied")
      content = (
        <Empty
          title="Access denied"
          body="You do not have permission to view this page."
        >
          <Link className="button" href={landing}>
            Return to {routeLabelFor(landing)}
          </Link>
        </Empty>
      );
    if (state === "session-expired")
      content = (
        <Empty
          title="Your session has expired."
          body="Sign in again to continue."
        >
          <Link className="button" href="/admin/login">
            Sign In
          </Link>
        </Empty>
      );
    if (!known.includes(route))
      content = (
        <Empty
          title="Record not found"
          body="This record may no longer be available."
        />
      );
  }

  return (
    <main id="main" className="admin-shell">
      <AdminSidebar
        role={role ?? undefined}
        account={
          session
            ? {
                identifier:
                  session.displayName || session.email || session.userId,
                role: roleLabel(session.role),
              }
            : undefined
        }
      />
      <div className="admin-main">
        <div className="workspace-label">
          <span>
            <BrandText text="2nd Wave / Administration" />
          </span>
          {session ? (
            <>
              <span className="badge">{roleLabel(session.role)}</span>
              <span className="badge">Sample data</span>
            </>
          ) : (
            <span className="badge">Demo workspace</span>
          )}
        </div>
        <PasswordUpdatedNotice notice={notice} />
        {dataNotice && <Notice>{dataNotice}</Notice>}
        <Reveal>{content}</Reveal>
      </div>
    </main>
  );
}

function routeLabelFor(href: string): string {
  const resolution = resolveAdminRoute(href);
  return resolution.kind === "known" ? resolution.route.label : "Dashboard";
}

function PasswordUpdatedNotice({ notice }: { notice?: string }) {
  if (notice !== "password-updated") return null;
  return <Notice success>Your password has been updated.</Notice>;
}

function Auth({
  mode,
  state,
  next,
  configError,
  recoveryReady,
}: {
  mode: string;
  state?: string;
  next: string;
  configError: string | null;
  recoveryReady: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const reset = mode === "reset-password",
    set = mode === "set-password";
  const title = reset
    ? "Reset your password"
    : set
      ? "Set new password"
      : "Admin Sign In";
  // Fail closed: without production authentication configured and with demo
  // mode disabled, the form is not offered at all.
  const blocked = Boolean(configError) && !demoMode;
  const linkUnavailable = set && (state === "unavailable" || !recoveryReady);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (set && password !== confirm) {
      setError("Your passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      if (set) {
        const result = await updateAdminPassword({ password, confirm });
        setBusy(false);
        if ("error" in result) setError(result.error);
        return;
      }
      if (reset) {
        const result = await requestAdminPasswordReset({ email });
        setBusy(false);
        if ("error" in result) setError(result.error);
        else setSent(true);
        return;
      }
      const result = await signInAdmin({ email, password, next });
      setBusy(false);
      if (result?.error) setError(result.error);
    } catch (cause) {
      if (isFrameworkNavigation(cause)) return;
      setBusy(false);
      setError("Sign-in could not be completed. Please try again.");
    }
  }

  if (linkUnavailable)
    return (
      <div className="auth-card">
        <Empty
          title="Reset link unavailable"
          body="This password reset link has expired, was already used, or the account is not an active administrator. Request a new link to continue."
        >
          <Link className="button" href="/admin/reset-password">
            Reset your password
          </Link>
        </Empty>
      </div>
    );
  return (
    <div className="auth-card">
      <Logo large />
      <p className="eyebrow">Administration</p>
      <h1>{title}</h1>
      {sent ? (
        <>
          <Notice success>
            If this email is authorised, you’ll receive password reset
            instructions.
          </Notice>
          {!configError && (
            <p className="demo-caption">
              Preview only. No email was sent and no password was changed.
            </p>
          )}
          <Link className="button" href="/admin/login">
            Return to Sign In
          </Link>
        </>
      ) : (
        <form onSubmit={submit} className="form-stack">
          {blocked && <Notice error>{configError}</Notice>}
          {!blocked && error && <Notice error>{error}</Notice>}
          {!set && (
            <TextField
              id="auth-email"
              label="Email address"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}{" "}
          {!reset && (
            <TextField
              id="auth-password"
              label="Password"
              type="password"
              required
              minLength={set ? 12 : 1}
              autoComplete={set ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}{" "}
          {set && (
            <TextField
              id="auth-confirm"
              label="Confirm password"
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          )}
          <Submit
            busy={busy}
            label={
              reset ? "Send Reset Link" : set ? "Update Password" : "Sign In"
            }
            busyLabel={reset ? "Sending…" : "Signing in…"}
          />
          {!reset && !set && (
            <Link className="text-link" href="/admin/reset-password">
              Forgot Password?
            </Link>
          )}
        </form>
      )}
      {configError && !blocked && (
        <p className="demo-caption">{configError}</p>
      )}
      {demoMode && (
        <div className="demo-entry">
          <p>
            Simulated access for design review. No real credentials are needed
            and no production data is reachable.
          </p>
          <button
            className="button secondary"
            onClick={() => {
              sessionStorage.setItem("wave-demo-session", "active");
              router.push("/admin");
            }}
          >
            Enter Demo Workspace <ArrowUpRight size={18} />
          </button>
        </div>
      )}
      {blocked && (
        <p className="demo-caption">
          <ShieldAlert size={14} /> Administrator authentication is switched
          off in this environment. Contact the project owner.
        </p>
      )}
    </div>
  );
}

function Dashboard({
  empty,
  modules,
}: {
  empty: boolean;
  modules: AdminRouteDefinition[];
}) {
  const store = useDemoStore();
  const bookings = empty ? [] : store.bookings;
  const leads = empty ? [] : store.leads;
  const cards = [
    [
      "Pending bookings",
      bookings.filter((b) => b.status === "pending").length,
      CalendarDays,
      "",
    ],
    [
      "Active bookings",
      bookings.filter(
        (b) => !["pending", "completed", "cancelled"].includes(b.status),
      ).length,
      Clock,
      "",
    ],
    [
      "New enquiries",
      leads.filter(
        (l) => ["general", "commercial"].includes(l.kind) && l.status === "new",
      ).length,
      MessageSquare,
      "",
    ],
    [
      "Reviews awaiting approval",
      leads.filter((l) => l.kind === "review" && l.status === "new").length,
      CheckCircle2,
      "/admin/reviews",
    ],
  ] as const;
  return (
    <>
      <Heading title="Dashboard" />
      <div className="metrics">
        {cards.map(([title, count, Icon, href]) =>
          href ? (
            <Link className="metric" href={href} key={title}>
              <div>
                <span>{title}</span>
                <Icon size={22} />
              </div>
              <strong>{count}</strong>
            </Link>
          ) : (
            <Reveal key={title} className="metric">
              <div>
                <span>{title}</span>
                <Icon size={22} />
              </div>
              <strong>{count}</strong>
            </Reveal>
          ),
        )}
      </div>
      <div className="admin-columns">
        <section className="panel">
          <div className="section-title">
            <h2>Recent bookings</h2>
            <Link href="/admin/bookings">View All ↗</Link>
          </div>
          {bookings.length ? (
            bookings.slice(0, 5).map((b) => (
              <Link
                className="record-row"
                key={b.id}
                href={`/admin/bookings/${b.id}`}
              >
                <div>
                  <small>{b.reference}</small>
                  <h3>{b.input.name}</h3>
                  <p>{b.input.items}</p>
                </div>
                <span className={`badge ${b.status}`}>
                  {statusLabel(b.status)}
                </span>
              </Link>
            ))
          ) : (
            <Empty title="No requests to show yet." />
          )}
        </section>
        <section className="panel">
          <div className="section-title">
            <h2>Recent enquiries</h2>
            <Link href="/admin/enquiries">View All ↗</Link>
          </div>
          {leads
            .filter((l) => ["general", "commercial"].includes(l.kind))
            .slice(0, 5)
            .map((l) => (
              <Link
                className="record-row"
                key={l.id}
                href={`/admin/enquiries/${l.id}`}
              >
                <div>
                  <small>
                    {l.kind === "commercial"
                      ? "Commercial quote"
                      : "General enquiry"}
                  </small>
                  <h3>{l.fields.name}</h3>
                </div>
                <span className="badge">{statusLabel(l.status)}</span>
              </Link>
            ))}
          {!leads.some((l) => ["general", "commercial"].includes(l.kind)) && (
            <Empty title="No requests to show yet." />
          )}
        </section>
      </div>
      <section className="section">
        <p className="eyebrow">Console modules</p>
        <div className="grid three">
          {modules.map(({ key, label, href }) => (
            <Link className="module-card" href={href} key={key}>
              <h3>{label}</h3>
              <ArrowUpRight />
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
