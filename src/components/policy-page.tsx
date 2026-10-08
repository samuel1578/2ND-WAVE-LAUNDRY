import Link from "next/link";
import { Fragment } from "react";
import { ChevronRight } from "lucide-react";
import { copy } from "@/lib/content";
import {
  brandHighlights,
  splitHighlighted,
} from "@/lib/brand-highlight";
import { Action, Empty, Heading } from "./ui";
import { DottedGlowBackground } from "./dotted-glow-background";

const policyHighlights = [
  ...brandHighlights,
  "059 522 4280",
  "48 hours",
  "30 minutes",
  "30 days",
  "3 hours",
  "7:00 AM",
  "8:00 PM",
  "10x",
];
function PolicyText({ text }: { text: string }) {
  return (
    <>
      {splitHighlighted(text, policyHighlights).map((part, index) =>
        part.match ? (
          <span
            key={`${part.text}-${index}`}
            className="brand-glow"
          >
            {part.text}
          </span>
        ) : (
          <Fragment key={`${part.text}-${index}`}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}

type PolicySection = {
  heading: string;
  intro?: string;
  body?: string;
  list?: string[];
};
type PolicyPageContent = {
  title: string;
  intro?: string;
  preamble?: string;
  sections: PolicySection[];
  related: { label: string; href: string };
};
const splitList = (value: string) => value.split("\n").filter(Boolean);
function policyContent(slug: string): PolicyPageContent | null {
  switch (slug) {
    case "privacy":
      return {
        title: "Privacy Policy",
        intro: copy("18", "Privacy intro"),
        preamble: copy("18", "Privacy preamble"),
        sections: [1, 2, 3].map((n) => ({
          heading: copy("18", `Privacy ${n} heading`),
          body: copy("18", `Privacy ${n} body`),
        })),
        related: { label: "View Terms", href: "/terms" },
      };
    case "terms":
      return {
        title: "Terms & Conditions",
        sections: [1, 2, 3].map((n) => ({
          heading: copy("18", `Terms ${n} heading`),
          intro: copy("18", `Terms ${n} intro`),
          list: splitList(copy("18", `Terms ${n} list`)),
        })),
        related: {
          label: "View Laundry Care Terms",
          href: "/laundry-care-terms",
        },
      };
    case "laundry-care-terms":
      return {
        title: copy("18", "H1"),
        sections: [
          {
            heading: copy("18", "Care 1 heading"),
            intro: copy("18", "Care 1 intro"),
            list: splitList(copy("18", "Care 1 list")),
          },
        ],
        related: { label: "View Privacy Policy", href: "/privacy" },
      };
    default:
      return null;
  }
}
function isComplete(page: PolicyPageContent) {
  return (
    page.sections.length > 0 &&
    page.sections.every(
      (section) =>
        section.heading &&
        (section.body || section.intro || (section.list?.length ?? 0) > 0),
    )
  );
}
function Bullet({ line }: { line: string }) {
  const at = line.indexOf(": ");
  if (at === -1) return <PolicyText text={line} />;
  return (
    <>
      <strong>
        <PolicyText text={line.slice(0, at + 1)} />
      </strong>{" "}
      <PolicyText text={line.slice(at + 2)} />
    </>
  );
}
export function PolicyPage({ slug }: { slug: string }) {
  const page = policyContent(slug);
  if (!page || !isComplete(page))
    return (
      <div className="container narrow">
        <Heading title={page?.title ?? "Policy"} />
        <Empty
          title="Not yet published"
          body="The client-approved policy text has not been supplied. This page is not a completed legal policy."
        >
          <Action href="/contact" secondary>
            Contact the Team
          </Action>
        </Empty>
      </div>
    );
  const showToc = page.sections.length > 1;
  return (
    <>
      <section className="page-hero">
        <DottedGlowBackground gap={14} radius={1.8} opacity={0.75} />
        <div className="page-hero__inner">
          <Heading
            eyebrow="Legal & Compliance"
            title={page.title}
            description={page.intro || undefined}
          />
        </div>
      </section>
      <div className="container policy-doc">
        <div className="stack">
          {showToc && (
            <nav className="panel policy-toc" aria-label="Table of contents">
              <div className="policy-toc__head">
                <strong>Sections Overview</strong>
                <small>{page.sections.length} Key Provisions</small>
              </div>
              <ol>
                {page.sections.map((section, i) => (
                  <li key={section.heading}>
                    <a href={`#section-${i + 1}`}>
                      <span>
                        {i + 1}. {section.heading}
                      </span>
                      <ChevronRight size={16} aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          )}
          {page.preamble && (
            <p className="policy-preamble">
              <PolicyText text={page.preamble} />
            </p>
          )}
          {page.sections.map((section, i) => (
            <section
              className="panel policy-section"
              id={`section-${i + 1}`}
              key={section.heading}
            >
              <h2>
                <PolicyText text={section.heading} />
              </h2>
              {section.intro && (
                <p>
                  <PolicyText text={section.intro} />
                </p>
              )}
              {section.body && (
                <p>
                  <PolicyText text={section.body} />
                </p>
              )}
              {section.list && section.list.length > 0 && (
                <ul className="policy-bullets">
                  {section.list.map((line) => (
                    <li key={line}>
                      <Bullet line={line} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          <div className="panel policy-related">
            <div>
              <strong>Related Policies</strong>
              <small>Terms of Service &amp; Care Provisions</small>
            </div>
            <Link className="text-link" href={page.related.href}>
              {page.related.label}
              <ChevronRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
