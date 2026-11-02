/**
 * Branch-specific long-form content and local facts.
 *
 * Display values (phone, hours, map link) stay in `src/lib/content.ts`, which
 * is the single source the database rows are reconciled against. This file only
 * adds copy that is unique to each branch, plus facts the public page needs and
 * that are not stored in the CMS.
 *
 * Deliberate omissions (see docs/seo/00-AUDIT.md TODO list):
 * - street addresses and Google Business Profile URLs are not published on the
 *   site, so they are not emitted in copy or structured data;
 * - latitude/longitude are unknown, so `geo` is omitted from LocalBusiness.
 * Nothing here may be invented to fill them.
 */

export type BranchProfile = {
  slug: string;
  /** Town used as `addressLocality`. */
  locality: string;
  /** Areas this branch realistically covers, used for `areaServed`. */
  areaServed: string[];
  /** Unique introduction, shown under the branch heading. */
  intro: string;
  /** Two or three unique paragraphs about visiting this branch. */
  visiting: string[];
  /** Branch-specific questions, answered only from published site copy. */
  faq: { q: string; a: string }[];
  /** Optional coordinates (only when supplied by the owner). */
  latitude?: number;
  longitude?: number;
};

export const branchProfiles: Record<string, BranchProfile> = {
  "ashaiman-atadeka": {
    slug: "ashaiman-atadeka",
    locality: "Ashaiman",
    areaServed: ["Ashaiman", "Atadeka", "Greater Accra"],
    intro:
      "Ashaiman–Atadeka is the 2nd Wave Laundry Services main branch. It is the drop-off point for walk-in customers in Ashaiman and the branch our main team coordinates pickup requests from.",
    visiting: [
      "Walk-ins and drop-offs are welcome during opening hours. The branch is open Monday to Saturday from 7am to 8pm, and Sunday from 9am to 7:30pm, so a weekend drop-off is possible without taking time off work.",
      "Bring your items to the counter and tell the team what needs attention. Everyday laundry can be arranged as wash, ironing and fold, or wash and fold only. Items that fall outside those services, including bedding, suits, Kente cloth, rugs and sneakers, are discussed with the team so they can recommend the right service.",
      "Online pickup requests are handled by the main team, who arrange the appropriate branch and confirm the practical details with you. A submitted request stays pending until the team confirms it; the fee and the timing are agreed with you before the booking is confirmed.",
    ],
    faq: [
      {
        q: "Is Ashaiman–Atadeka the main 2nd Wave Laundry branch?",
        a: "Yes. Ashaiman–Atadeka is labelled the main branch and uses the main number, 059 522 4280. Pickup requests placed online are handled by the main team, who arrange the appropriate branch.",
      },
      {
        q: "What are the opening hours for the Ashaiman–Atadeka branch?",
        a: "The branch is open Monday to Saturday from 7am to 8pm and Sunday from 9am to 7:30pm. Opening hours are also listed on the branch page so you can check before visiting.",
      },
      {
        q: "Can I request same-day laundry from this branch?",
        a: "Express/Same-Day Laundry that needs pickup and service the same day must be requested by 11am. Same-day service is not guaranteed; the team confirms availability, the fee and completion timing with you.",
      },
    ],
  },
  "katamanso-no-1": {
    slug: "katamanso-no-1",
    locality: "Katamanso",
    areaServed: ["Katamanso", "Newland Katamanso", "Greater Accra"],
    intro:
      "Katamanso No. 1 is one of the three 2nd Wave Laundry Services branches and has its own direct phone line for customers dropping off in Katamanso.",
    visiting: [
      "Walk-ins and drop-offs are welcome throughout the day. This branch is open from 7am to 8pm, and the branch number, 059 814 8620, reaches the team directly if you want to ask about your items before setting out.",
      "The full service list is available through the branch: wash, ironing and fold, wash and fold only, ironing, stain treatment, duvet and bedding cleaning, curtain cleaning, suit cleaning, shoe care and express laundry. Tell the team about stains, delicate fabrics or care labels when you drop off, and mention anything you have already tried on a stain.",
      "If you would rather not travel, book a pickup instead. Collection requests are arranged by the main team and confirmed with you, and the request is not a confirmed booking until the team has spoken to you.",
    ],
    faq: [
      {
        q: "What is the phone number for the Katamanso No. 1 branch?",
        a: "Call 059 814 8620. It is a branch-specific number, separate from the main 059 522 4280 line used for pickup requests and general enquiries.",
      },
      {
        q: "What time does the Katamanso No. 1 branch open?",
        a: "The branch is open from 7am to 8pm. Its opening hours are published on the branch page alongside the branch phone number.",
      },
      {
        q: "Do I need an appointment to drop off laundry in Katamanso?",
        a: "No. Walk-ins and drop-offs are welcome at all three branches. You only need to contact the team in advance if you want a pickup arranged instead.",
      },
    ],
  },
  "newland-katamanso": {
    slug: "newland-katamanso",
    locality: "Katamanso",
    areaServed: ["Newland Katamanso", "Katamanso", "Greater Accra"],
    intro:
      "Newland Katamanso is a 2nd Wave Laundry Services branch with its own phone line, serving customers who prefer to drop laundry off close to home rather than arranging collection.",
    visiting: [
      "The branch opens from 7am to 8pm. Call 024 614 4412 to reach the branch team directly, whether you want to check on an item, ask about a service or confirm the hours before you travel.",
      "Drop-offs are welcome without an appointment. The team accepts everyday laundry for washing, ironing and folding, and can discuss the other services on the site when your items need something different, such as stain treatment, bedding, curtains, suits or shoe care.",
      "Collection is available if getting to the branch is difficult. Submit a pickup request, then continue the conversation on WhatsApp; our customer service team confirms the arrangements, the fee and the timing with you before the booking is confirmed.",
    ],
    faq: [
      {
        q: "Where is the Newland Katamanso branch phone number listed?",
        a: "The branch number is 024 614 4412. It appears on the branch page, the locations page and the contact page alongside the address area and opening hours.",
      },
      {
        q: "Can I collect my laundry from the Newland Katamanso branch?",
        a: "Yes. The branch is a walk-in and drop-off location open from 7am to 8pm. Collection arrangements for pickup orders are confirmed with the team.",
      },
      {
        q: "Does the Newland Katamanso branch offer the same services as the main branch?",
        a: "The published service list applies across the three branches. If an item needs special handling, the team discusses the appropriate service and the fee with you before work starts.",
      },
    ],
  },
};

/** Areas served only by pickup and delivery. Intentionally empty until confirmed. */
export const serviceAreas: {
  slug: string;
  name: string;
  nearestBranch: string;
  intro: string;
}[] = [];

export function branchProfileFor(slug: string): BranchProfile | undefined {
  return branchProfiles[slug];
}
