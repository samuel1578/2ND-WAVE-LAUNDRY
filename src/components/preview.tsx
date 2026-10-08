"use client";
import Link from "next/link";
import { useState } from "react";
import { branches, services } from "@/lib/content";
import {
  codeManagedModules,
  contentModules,
} from "./admin/content/content-config";
import { Promotion } from "./published-content";
import { Empty, Heading, Skeleton } from "./ui";
import { Notice } from "./forms/controls";
import { DottedGlowBackground } from "./dotted-glow-background";
export function PreviewPage() {
  const [state, setState] = useState("overview");
  const publicPages = [
    ["Home", "/"],
    ["Services", "/services"],
    ...services.map((s) => [s.title, `/services/${s.slug}`]),
    ["Commercial Laundry", "/commercial-laundry"],
    ["Commercial Quote", "/commercial-laundry/quote"],
    ["How It Works", "/how-it-works"],
    ["Locations", "/locations"],
    ...branches.map((b) => [b.title, `/locations/${b.slug}`]),
    ["About", "/about"],
    ["Contact", "/contact"],
    ["Gallery", "/gallery"],
    ["Blog", "/blog"],
    ["FAQs", "/faq"],
    ["Reviews", "/reviews"],
    ["Share Your Experience", "/reviews/share"],
    ["Book a Pickup", "/book"],
    ["Online requests paused", "/book?state=paused"],
    ["Privacy Policy", "/privacy"],
    ["Terms & Conditions", "/terms"],
    ["Laundry Care Terms", "/laundry-care-terms"],
    ["Page not found", "/page-that-does-not-exist"],
  ];
  return (
    <>
      <section className="page-hero">
        <DottedGlowBackground gap={14} radius={1.8} opacity={0.75} />
        <div className="page-hero__inner">
          <Heading
            title="Frontend review"
            description="Review public pages, admin workflows and reusable interface states. All records and writes are demo-only."
          />
        </div>
      </section>
      <div className="container">
        <Notice>
          Photography comes from design references. Verify image rights and
          approve replacements before launch. Policy bodies, real articles,
          genuine reviews and backend integration are still required.
        </Notice>
        <div className="filters">
          {["overview", "loading", "error", "promotion"].map((s) => (
            <button
              className={state === s ? "active" : ""}
              key={s}
              onClick={() => setState(s)}
            >
              {s}
            </button>
          ))}
        </div>
        {state === "loading" ? (
          <Skeleton count={6} />
        ) : state === "error" ? (
          <Empty
            title="This page isn’t available right now."
            body="Please try again."
          >
            <button className="button" onClick={() => setState("overview")}>
              Try Again
            </button>
          </Empty>
        ) : state === "promotion" ? (
          <Promotion force />
        ) : (
          <>
            <section className="section">
              <h2>Public website</h2>
              <div className="route-grid">
                {publicPages.map(([name, href]) => (
                  <Link key={href} href={href}>
                    <span>{name}</span>
                    <small>{href}</small>
                  </Link>
                ))}
              </div>
            </section>
            <section className="section">
              <h2>Administration</h2>
              <p>Enter the demo workspace from Admin Sign In first.</p>
              <div className="route-grid">
                {[
                  ["Admin Sign In", "/admin/login"],
                  ["Password reset", "/admin/reset-password"],
                  ["Set new password", "/admin/set-password"],
                  [
                    "Reset link unavailable",
                    "/admin/set-password?state=unavailable",
                  ],
                  ["Dashboard", "/admin"],
                  ["Dashboard empty", "/admin?state=empty"],
                  ["Bookings", "/admin/bookings"],
                  ["Pending booking", "/admin/bookings/demo-1"],
                  ["Enquiries", "/admin/enquiries"],
                  ["Newsletter Interest", "/admin/newsletter"],
                  ["Website Content", "/admin/content"],
                  ...contentModules.map((m) => [m.name, `/admin/content/${m.slug}`]),
                  ...codeManagedModules.map((m) => [
                    `${m.name} (code-managed)`,
                    `/admin/content/${m.slug}`,
                  ]),
                  ["Reviews (admin)", "/admin/reviews"],
                  ["Reviews moved notice", "/admin/content/reviews"],
                    ["Branch editor", "/admin/content/locations/katamanso-no-1"],
                    ["Service editor", "/admin/content/services/wash-ironing-fold"],
                    ["Article editor", "/admin/content/blog/new"],
                  ["Media Library", "/admin/media"],
                  ["Upload Media", "/admin/media/upload"],
                  ["Media Details", "/admin/media/media-0"],
                  ["Settings", "/admin/settings"],
                  ["Admin loading", "/admin?state=loading"],
                  ["Admin load error", "/admin?state=error"],
                  ["Session expired", "/admin?state=session-expired"],
                  ["Access denied", "/admin?state=access-denied"],
                  ["Record not found", "/admin/bookings/unavailable"],
                  ["Content loading", "/admin/content?state=loading"],
                  ["Media empty", "/admin/media?state=empty"],
                ].map(([name, href]) => (
                  <Link key={href} href={href}>
                    <span>{name}</span>
                    <small>{href}</small>
                  </Link>
                ))}
              </div>
            </section>
            <section className="panel">
              <h2>Interactive state checklist</h2>
              <ul>
                <li>
                  Submit forms blank to inspect validation. Inputs survive an
                  unsuccessful save.
                </li>
                <li>
                  Use “Simulate next save failure” in Preview controls to
                  inspect save errors and retry.
                </li>
                <li>
                  Submit a demo pickup to inspect the pending result and
                  editable WhatsApp draft.
                </li>
                <li>
                  Select Express/Same-Day Laundry and today after 11am to
                  inspect the cutoff notice. Ordinary pickup remains available
                  before 5pm.
                </li>
                <li>
                  Upload unsupported or oversized files to inspect media
                  validation.
                </li>
                <li>
                  Try deleting the in-use media asset to inspect the referential
                  lock.
                </li>
                <li>
                  Edit content or settings, then follow a link to inspect the
                  unsaved-changes dialog.
                </li>
                <li>
                  Use the menu’s System / Light / Dark controls; the default
                  follows device preferences.
                </li>
              </ul>
            </section>
          </>
        )}
      </div>
    </>
  );
}
