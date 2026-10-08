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
} from "lucide-react";
import { adminNav, demoMode } from "@/lib/content";
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
export function AdminApp({
  segments,
  state,
}: {
  segments: string[];
  state?: string;
}) {
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const route = segments[0] || "";
  useEffect(() => {
    setAllowed(
      demoMode && sessionStorage.getItem("wave-demo-session") === "active",
    );
  }, []);
  if (["login", "reset-password", "set-password"].includes(route))
    return (
      <main id="main" className="container public-main">
        <Auth mode={route} state={state} />
      </main>
    );
  if (allowed === null)
    return (
      <main id="main" className="container public-main">
        <Skeleton />
      </main>
    );
  if (!allowed)
    return (
      <main id="main" className="container public-main">
        <Empty
          title="Admin Sign In"
          body="This frontend includes a demo workspace only. Production authentication is not connected."
        >
          <Link className="button" href="/admin/login">
            Sign In
          </Link>
        </Empty>
      </main>
    );
  const known = [
    "",
    "bookings",
    "enquiries",
    "reviews",
    "newsletter",
    "content",
    "media",
    "settings",
  ];
  let content: React.ReactNode =
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
    ) : route === "" ? (
      <Dashboard empty={state === "empty"} />
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
        <Link className="button" href="/admin">
          Return to Dashboard
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
  return (
    <main id="main" className="admin-shell">
      <AdminSidebar />
      <div className="admin-main">
        <div className="workspace-label">
          <span>
            <BrandText text="2nd Wave / Administration" />
          </span>
          <span className="badge">Demo workspace</span>
        </div>
        <Reveal>{content}</Reveal>
      </div>
    </main>
  );
}
function Auth({ mode, state }: { mode: string; state?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const reset = mode === "reset-password",
    set = mode === "set-password";
  const title = reset
    ? "Reset your password"
    : set
      ? "Set new password"
      : "Admin Sign In";
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (set && password !== confirm) {
      setError("Your passwords do not match.");
      return;
    }
    setBusy(true);
    await new Promise((r) => setTimeout(r, 400));
    setBusy(false);
    if (reset || set) {
      setDone(true);
    } else
      setError(
        "Authentication is not connected. Use Enter Demo Workspace to review this frontend.",
      );
  }
  if (state === "unavailable")
    return (
      <div className="auth-card">
        <Empty
          title="Reset link unavailable"
          body="Request a new password reset link to continue."
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
      {done ? (
        <>
          <Notice success>
            {reset
              ? "If this email is authorised, you’ll receive password reset instructions."
              : "Password updated."}
          </Notice>
          <p className="demo-caption">
            Preview only. No email was sent and no password was changed.
          </p>
          <Link className="button" href="/admin/login">
            Return to Sign In
          </Link>
        </>
      ) : (
        <form onSubmit={submit} className="form-stack">
          {error && <Notice error>{error}</Notice>}
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
      {demoMode && (
        <div className="demo-entry">
          <p>No real credentials needed for this preview.</p>
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
    </div>
  );
}
function Dashboard({ empty }: { empty: boolean }) {
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
          {adminNav.slice(1).map(([label, href]) => (
            <Link className="module-card" href={href} key={href}>
              <h3>{label}</h3>
              <ArrowUpRight />
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
