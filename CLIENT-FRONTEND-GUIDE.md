# 2nd Wave Laundry Services — Frontend Review Guide

A plain-language guide to the **frontend build** of the 2nd Wave Laundry website and administration console. It explains what every page does, how it behaves on desktop and mobile, and how the admin console relates to the public website.

Use this document while clicking through the build. Nothing here is sent to the business: every request, enquiry, review and edit stays inside the browser session and resets when the page is refreshed.

---

## 1. What this build is

| | |
|---|---|
| **Type** | Frontend-only demonstration of the full public website plus an administration console |
| **Framework** | Next.js (App Router) with React and TypeScript |
| **Purpose** | Visual, interaction and workflow review before backend integration |
| **Data** | Held in browser memory only (a "demo store"). No database, no email, no payments |
| **Language / locale** | English (Ghana). Phone numbers validated for Ghana (`+233`) |
| **Reset** | Refreshing the browser returns all demo records to their starting state |

### What is real vs. simulated

- **Real**: layout, responsive behaviour, navigation, forms, validation, admin workflows, status rules, image presentation.
- **Simulated**: saving data, uploading files, sending messages, taking payment, sending email.
- **Not connected**: authentication, the backend API (it deliberately refuses requests), and any permanent storage.

A blue **preview banner** appears at the top of every page while the demo is active.

---

## 2. How to run and review

1. Start the project (developer): `npm run dev`, then open `http://localhost:3000`.
2. On any device, review the public pages first (Section 5).
3. Open **Book a Pickup** and complete a request to see the confirmation and WhatsApp draft (Section 6).
4. To review the admin console, go to `/admin/login` and press **Enter Demo Workspace** (Section 7).
5. Visit `/preview` for a clickable index of every page and state (Section 4.5).

> Tip for mobile review: use the browser's device toolbar at **375 × 812** (a typical phone). All mobile-specific behaviour below is written for ~375px wide screens.

---

## 3. The demo store in one paragraph

The console and the public forms share one temporary in-memory store. It starts pre-loaded with **three sample bookings** (pending, processing, ready), the **service catalogue**, the **three branches**, the website **gallery images**, the **FAQ list** and a **marketing media library**. Submitted forms are added to it live; edits made in the console persist for the session. Refreshing the page discards everything and reloads the samples. A **"Simulate next save failure"** control (available near forms) forces the next save to fail once so you can review the error and retry paths.

---

## 4. Global interface (applies to every page)

### 4.1 Header

**Desktop**
- Logo on the left, horizontal navigation in the centre, **Book Now** button and menu button on the right.
- The centre navigation shows: Services, How It Works, Locations, About, Blog, Contact.
- A subtle indicator slides under the active/hovered link.

**Mobile (≤ 900px wide)**
- The horizontal navigation is hidden; the logo, **Book Now** and a menu button remain.
- Pressing the menu opens a full navigation panel containing: the complete site menu, an appearance control, and quick actions (Book a Pickup, Visit a Branch, Chat on WhatsApp, phone number).

**On admin pages**
- The header changes: the public menu/book button are replaced by a **Sign Out** button and the menu button. The menu panel shows the admin modules with icons.

### 4.2 Footer

- **Public pages**: four columns — brand/phone, "Explore", "Get in touch" (including WhatsApp and Instagram/TikTok), and "Follow along" with the appearance control. Policy links sit in the bottom bar (Privacy Policy, Terms & Conditions, Laundry Care Terms).
- **Admin pages**: a slim single-line copyright footer.

### 4.3 Appearance (light / dark / system)

- A three-way control (System, Light, Dark) appears in the mobile menu, the footer, and the admin sidebar.
- Default is **System**, which follows the visitor's device setting. The choice is remembered on the device.

### 4.4 Responsive breakpoints

The layout is tuned at these widths. Use them in the device toolbar:

| Width | Behaviour summary |
|---|---|
| ≤ 700px | Phone layout: single-column grids, swipe carousels with dot indicators, condensed spacing |
| 701 – 900px | Tablet: side-by-side grids begin to return; gallery slider switches to desktop arrows/peek |
| ≥ 901px | Desktop navigation appears; multi-column layouts, sticky side panels |
| ≥ 1200px / ≥ 1500px | Wider container and larger hero/grid scaling |

A **mobile swipe treatment** replaces vertical card stacks on small screens: cards become a horizontally scrollable track where part of the next card peeks in to signal swiping, with tappable dot indicators below. This is used by the home page services section and the **Services** page.

### 4.5 Preview page (`/preview`)

A review-only page (demo mode only) that lists:
- Every **public page** as a clickable link, including branch and service detail pages, the booking form, the "requests paused" state and a not-found example.
- Every **admin page** and key **states**: loading, load error, session expired, access denied, record not found, empty lists, and editor examples.
- An **interactive state checklist** (validation, simulated save failure, cutoff notice, media validation, referential lock, unsaved-changes dialog, theme switching).

This is the fastest way to see everything in one place.

---

## 5. Public website — page by page

Legend for each page: **Desktop** = behaviour at ≥ 901px, **Mobile** = behaviour at ≤ 700px.

### 5.1 Home (`/`)

The landing experience, built from these sections top to bottom.

**Hero**
- **Desktop (with motion allowed)**: a three-chapter scrolling story. Scrolling pins the hero and moves through "Opening", "Care in Motion" and "Collection & Drop-off", with a progress indicator.
- **Mobile / reduced motion / short screens**: a **static hero** is shown instead — a single, calmer hero with the brand line, intro, quick facts (walk-ins welcome, three branches, pickup 7am–5pm) and calls to action. This is automatic and is why phones do not get the long scroll animation.

**Services** — a three-column card grid on desktop; on mobile it becomes the **swipe track** with a peek of the next card and dots. A "View All Services" button follows.

**Pickup or drop-off** — two choice cards: Book a Pickup (to the booking form) and Walk-ins (to Locations).

**How it works (process)** — three numbered steps with a "See How It Works" link.

**Promotion (campaign banner)** — appears only when an approved campaign is active and its dates are client-confirmed. In this build the demo store starts with none, so it is hidden; open the **Promotion** tab at `/preview` to see the design.

> Note: the home promotion banner reads *published* campaign content with client-confirmed dates. The **Promotions manager** in the console (7.6.6) is a separate, admin-only campaign workspace and does not publish the banner in this build.

**Find your nearest branch** — three branch cards with phone, opening hours, "View Branch" and, where a map link exists, a "View in Maps" button.

**A closer look (gallery highlight)** — a slider of gallery images.
- **Desktop**: a peek-style slider with side arrows, hover zoom, and a caption on the **active slide only**.
- **Mobile**: a simple image slider with dot indicators and a peek of the next image. **Captions are hidden on mobile** to match the Gallery page; the descriptive text is available in the image viewer instead.

**Commercial Laundry section** — an editorial split promoting commercial services, linking to the quote request.

**FAQ** — the first few questions in an accordion, with a "View All FAQs" link.

**Closing call-to-action** and a **Newsletter interest** block (see 6.4). The newsletter block is hidden until **Newsletter interest** is enabled in the console's Settings (7.8).

### 5.2 Services (`/services`)

- Lists every service plus Commercial Laundry as cards.
- **Desktop**: a three-column grid (unchanged from the original design).
- **Mobile**: the same **swipe track** used on the home page — one card at a time with the next card peeking, snap-to-card scrolling, and dot indicators. Tap a card to open its detail page.
- Closing section with Contact / Book a Pickup actions.

### 5.3 Service detail (`/services/{slug}`)

Examples: `/services/wash-ironing-fold`, `/services/ironing`, `/services/stain-treatment`.

- Breadcrumb (Home / Services / Service name).
- **Service hero**: image with a text panel; on mobile the image stacks above the panel.
- **Details band**: cards for process steps, information, eligibility, hours, collection, express, and so on, depending on the service.
- **Handover choice**: two cards — visit a branch, or arrange a pickup (pre-fills the booking form with the service).
- **FAQ** specific to the service.
- **Related services** list and a closing call-to-action with WhatsApp.

### 5.4 How It Works (`/how-it-works`)

- Hero with intro and actions.
- A five-step pickup timeline.
- Two choice cards: branch drop-off and express same-day service.
- Closing call-to-action.

### 5.5 Locations (`/locations`) and Branch (`/locations/{slug}`)

- **Locations**: background hero, three branch cards (name, label, hours, phone, map where available), and a "Book a Pickup" section.
- **Branch detail**: name, phone, opening-hours table, "Call Branch", optional "Get Directions ›" (opens the visitor's maps app), and a pickup cross-sell. Back-link returns to all branches.

### 5.6 About (`/about`)

Editorial hero with an image, a large body paragraph, a pickup/walk-in choice panel, and a closing call-to-action.

### 5.7 Contact (`/contact`)

- Hero, then a two-column layout: a **contact panel** (phone, Call, WhatsApp, Locations, and per-branch phone numbers) beside a **general enquiry form**.
- **Mobile**: the panel and form stack into one column.
- Submitting a general enquiry adds it to the console's Enquiries list (see 7.3) after validation.

### 5.8 Commercial Laundry (`/commercial-laundry`) and Quote (`/commercial-laundry/quote`)

- **Commercial page**: hero with image and actions, a three-step process, a commercial FAQ, and a closing quote call-to-action.
- **Quote page**: a business-focused form (business name, contact, quantities, frequency, location, requirements) with a confirmation screen.

### 5.9 Gallery (`/gallery`)

- Category filters: **All, Laundry, Garments, Branches**.
- An image slider identical in style to the home "A closer look" section.
  - **Desktop**: peek slider with side arrows and hover zoom.
  - **Mobile**: image slider with dot indicators.
- Gallery images have **no captions on the page**. Tapping an image opens the **image viewer** (lightbox) showing the full image and its descriptive text, with Previous/Next and arrow-key support.
- "No images in this category" appears if a filter has none.

### 5.10 Blog (`/blog`) and Article (`/blog/{slug}`)

- **Blog index**: cards for each **published** article. If none are published, a friendly empty state with links to Services and Contact.
- **Article**: title, summary, image, body text (paragraphs), and a link to explore services. Unpublished or unknown articles show a "couldn't find that page" state.

> Demo note: articles you publish in the console (7.6.5) appear on these public pages within the same session.

### 5.11 FAQ (`/faq`)

An accordion of all questions and answers, plus a Contact section. Items can be shown/hidden and reordered in the console (7.6.6), and the demo store seeds them from the approved list.

### 5.12 Reviews (`/reviews`) and Share (`/reviews/share`)

- **Reviews page**: public testimonials. Only reviews that are **approved and have publication consent** are shown. If none qualify, a share prompt is shown.
- **Share page**: a review form (name, rating, review, branch) with a consent checkbox. Submitting adds it to the console's Reviews queue (7.5).

> Demo note: approving a review in the console makes it appear publicly within the same session.

### 5.13 Policy pages

`/privacy`, `/terms`, `/laundry-care-terms` each render a formatted policy document with headings and body copy.

### 5.14 Not found

Unknown addresses show the site's styled "page not found" screen (try `/page-that-does-not-exist`).

---

## 6. Public forms and validation

All public forms validate before saving and keep the visitor's input even when a save fails.

### 6.1 Book a Pickup (`/book`)

A four-step wizard. A progress **stepper** (1–4) shows the current step; on mobile, connectors are simplified and labels are enlarged for legibility.

| Step | Contents | Key rules |
|---|---|---|
| 1. Your laundry | Service selection (multi-select), item category, load size, notes, optional photos | At least one service and a load size required. Up to 3 photos, ≤ 5MB each, JPEG/PNG/WebP |
| 2. Pickup details | Address, landmark, optional map link, preferred date and time, transport preference | Address required; date must be valid and not in the past; map link validated |
| 3. Contact details | Name, phone, optional email, WhatsApp number, preferred contact method, privacy acknowledgement | Valid Ghana phone required; valid email if provided; acknowledgement required |
| 4. Review request | A summary of everything entered, with an "Edit Details" shortcut | — |

**Scheduling rules** (driven by the console's Settings):
- Pickup operates within the configured start/end hours (default **07:00–17:00**).
- If today is chosen after pickup hours end, or a past time is entered, the visitor is asked to choose another date/time.
- **Express / Same-Day Laundry** requiring pickup today is only accepted before the **express cutoff** (default **11:00**); after that a clear notice explains the cutoff.

**After submitting**
- A confirmation screen shows a **demo reference** with a "Copy Reference" button and an **editable WhatsApp message draft** (Continue on WhatsApp / Copy Message).
- The request is added to the console as a **Pending** booking.
- **Requests paused**: if the console setting "Accept online pickup requests" is off (or the preview paused state is opened), the form is replaced by a "requests paused" panel with Call / WhatsApp / Locations options.

> Submit the same request twice — the second attempt reuses the same reference (no accidental duplicates).

### 6.2 General enquiry (`/contact`)

Name, phone, optional email, enquiry topic and message. Adds an **Enquiry** to the console.

### 6.3 Commercial quote (`/commercial-laundry/quote`)

Business name, contact name, phone, optional email, items/quantities, frequency, location and additional requirements. Adds a **Commercial quote** entry to the console.

### 6.4 Newsletter interest

On the home page and available via the newsletter form: an email address plus an opt-in checkbox. Adds a **Newsletter interest** record. Duplicate emails are not added twice while active. Email campaigns are **not** connected.

### 6.5 Review submission (`/reviews/share`)

Name, rating, review, branch, plus a consent checkbox. Adds a **Review** awaiting moderation in the console.

### 6.6 Validation behaviour (what you'll see)

- Required fields are marked with `*`; errors appear under the field with an alert icon and **focus moves to the error summary**.
- Invalid phone numbers, emails or map links are rejected with a helpful message.
- If a save fails (use "Simulate next save failure"), a clear error notice is shown and **no input is lost** — you can retry immediately.

---

## 7. Administration console

### Entering the console

- Go to **`/admin/login`**.
- Real sign-in is **not connected**: typing credentials returns a message explaining this. Press **Enter Demo Workspace** to open the console.
- The demo session is remembered in the browser tab (`sessionStorage`). **Sign Out** clears it.
- Other auth screens exist for review: **Reset password** (`/admin/reset-password`) and **Set new password** (`/admin/set-password`), including a "reset link unavailable" state.

**Without a session**, any `/admin/...` address shows a sign-in prompt instead of data.

### Layout

- **Desktop**: a fixed left sidebar (Workspace) with the eight modules, the appearance control, "Return Home" and "Sign Out"; content on the right with a "2nd Wave / Administration" label and a "Demo workspace" badge.
- **Mobile**: the sidebar is hidden; use the header **menu button** to navigate between modules.
- Wide tables become horizontally scrollable panels on small screens.

### 7.1 Dashboard (`/admin`)

- **Metric tiles**: Pending bookings, Active bookings, New enquiries, Reviews awaiting approval (the last links to Reviews).
- **Recent bookings** and **Recent enquiries**, each linking to their record.
- A **Console modules** grid linking to every admin area.
- Try `/admin?state=empty` for the empty variant.

### 7.2 Bookings (`/admin/bookings`)

**List view**
- Filters: **search** (reference, name, phone), **status**, **assigned branch** (including "Unassigned"), and **requested date**. A "Clear filters" link resets them.
- Table columns: Reference, Customer, Services, Requested pickup, Status, Assigned branch.
- Change **status** or **assigned branch** inline straight from the table row.

**Detail view (`/admin/bookings/{id}`)**
- **Customer details**, **Laundry details** (services, items, notes, photo filenames — preview only) and **Pickup request** panels.
- **Agreed arrangements** form: assign branch, agreed pickup date/time, pickup fee (GHS), reason for a zero fee, contact outcome, confirmation notes, agreed return details.
- **Update status** — only valid next statuses are offered.
- **Internal notes** (add notes) and a **Status history** timeline.
- **Draft WhatsApp Update** — composes a message you can review, copy, or open in WhatsApp (you send it manually).
- **Cancel Booking** — requires a reason.

**Status rules** (enforced automatically):

```
Pending      → Confirmed, Cancelled
Confirmed    → Scheduled, Picked up, Cancelled
Scheduled    → Picked up, Cancelled
Picked up    → Processing, Cancelled
Processing   → Ready, Cancelled
Ready        → Out for delivery, Completed, Cancelled
Out for delivery → Completed, Cancelled
Completed    → (final)
Cancelled    → (final)
```

- Confirming a booking requires the agreed arrangements (branch, agreed pickup, fee — and a reason if the fee is zero, contact outcome, and confirmation notes) to be completed first.

### 7.3 Enquiries (`/admin/enquiries`)

- Two tabs: **General enquiries** and **Commercial quotes**, with search.
- **Detail view** shows all submitted fields, internal notes, **Mark Contacted** and **Close Enquiry**.

### 7.4 Newsletter Interest (`/admin/newsletter`)

- Table of recorded email interest: address, consent, recorded date and status.
- **View Details** opens a dialog where you can **Record Withdrawal**.
- A note explains that email campaigns and provider integration are not enabled.

### 7.5 Reviews (`/admin/reviews`)

- Queue of customer reviews awaiting moderation.
- **Approve** or **Reject** each. If publication permission was not recorded, approval is blocked and a clear message is shown.
- Approved reviews appear on the public Reviews page within the session.

### 7.6 Website Content (`/admin/content`)

The hub for editor-managed website content. It opens with a **module dashboard** showing a count summary for each module, then the module list:

| Module | Purpose |
|---|---|
| **Services** | Catalogue entries with draft/published/archived lifecycle |
| **Locations** | The three branch records |
| **Gallery** | Selected media placed in the gallery |
| **Blog** | Editorial articles |
| **FAQs** | Questions and answers |
| **Promotions** | Time-boxed campaigns |

Also visible here:
- **Homepage**, **About** and **Policy Pages** show a "managed in code" notice — their approved layout and copy are controlled in the project source and are not editable here.
- **Reviews** shows a "moved" notice directing you to the dedicated Reviews area, because reviews are customer submissions, not editor-created content.

#### 7.6.1 Services manager

- **List**: cards showing title, summary and status badge (Published / Draft / Archived).
- **Editor (`/admin/content/services/{id}` or `/new`)**: title, slug, summary, body (plain text, no HTML), sort order, and a **Featured Media** picker from the Media Library.
- Actions: **Save Draft**, **Publish** (with confirmation), **Unpublish** (keeps the draft), **Archive**, **Delete Draft**, and a **Preview** dialog.
- Validation: required fields before publishing, slug format (`lowercase-with-hyphens`), and **unique slug** within the module. A published item keeps its live snapshot while a new draft is edited.

#### 7.6.2 Locations manager

- **List**: the three branches with phone, opening hours and map availability, plus "Edit Branch" and "View Public Page".
- **Editor**: branch name, label (badge), phone, map URL, opening-hours rows (add/remove, e.g. "7am–8pm"), and sort order.
- Branches **cannot be created or deleted** here — there are exactly three.
- Validation: valid phone, recognised Google/Apple map link, every hours row labelled, and opening-hour ranges in the `7am–8pm` format.

#### 7.6.3 Gallery manager

- Places **Media Library** images into the gallery.
- For each image: **alt text** (required), optional **caption**, **display order**, and **Show on Website / Hide from Website**.
- **Add Images** opens a multi-select picker; **Remove from Gallery** removes the placement **without deleting the library asset**.
- Validation: every placement needs media, alt text and a whole-number order ≥ 1.

#### 7.6.4 Blog manager

- Same lifecycle and editor as Services, but for articles.
- Published articles appear on the public Blog pages in this session.

#### 7.6.5 FAQs manager

- Edit question and answer inline, **Move Up / Move Down** to reorder, **Enable / Disable**, and **Delete** (with confirmation).
- Validation: every FAQ needs a question and an answer, and **questions must be unique**.

#### 7.6.6 Promotions manager

- **List**: campaign cards with a lifecycle badge: **Draft, Scheduled, Active, Paused, Ended**.
- **Editor**: internal title, heading, offer copy, terms, exclusions, CTA label and destination (http/https only), schedule (start and end), placement, priority, and two checkboxes — **Enabled** and **Offer dates confirmed by the client**.
- Lifecycle actions: **Activate** (drafts only; requires confirmed dates), **Pause**, **Resume**, **End**, and **Delete Draft**. Each action is restricted to the allowed current state and explains itself if not permitted.
- A **Preview** dialog shows the campaign as it would read.
- A promotion becomes **Active** or **Scheduled** based on its dates; an exclusive end date is used.

### 7.7 Media Library (`/admin/media`)

- **Grid** of marketing assets with search; each card shows the image, name, alt text and an "In use / Available" badge.
- **Upload Media** (`/admin/media/upload`): choose a file (WebP, JPEG, PNG, ≤ 5MB), then complete **alt text**, optional caption, **source** and **usage permission** (both required). An in-page progress bar supports **Cancel Upload**.
- **Media Details** (`/admin/media/{id}`): edit details, **Replace Media**, **Archive Media**, or **Delete Media** (with confirmation).
- **Referential lock**: an asset that is in use (by content, the gallery, or a recorded use) **cannot be archived or deleted** until its uses are removed — the error explains this.
- A notice states that **customer booking photos are strictly private** and never appear in the marketing library.

### 7.8 Settings (`/admin/settings`)

- **Business details**: business email (kept empty until confirmed in production).
- **Contacts and social links**: main phone, main WhatsApp, Instagram, TikTok, Facebook.
- **Booking requests**: "Accept online pickup requests" toggle. Turning it **off** asks for confirmation ("Pause new online requests?") and, once saved, the public booking form shows the paused panel.
- **Pickup rules**: pickup start time, pickup end time and express cutoff, with a plain-language explanation. Times must be ordered (start < cutoff < end).
- **Retention** (read-only): booking records expire after 12 months; customer photos after 90 days.
- **Newsletter interest**: enable/disable toggle (integration not connected).
- **Unsaved changes** are guarded: navigating away with edits open prompts a confirmation dialog.

---

## 8. How the admin console relates to the public website

This is the most important section for testing, because the links differ by module. In this **frontend build**, the public website renders from an approved, code-managed content baseline, while the console works on demo records. The table below shows exactly what is live-linked versus preview-only.

| Console area | Public effect in this build |
|---|---|
| **Bookings** | Source records for the Dashboard metrics and lists. Created when a visitor submits the booking form |
| **Enquiries** | Source records for Dashboard metrics. Created from the Contact and Commercial quote forms |
| **Reviews** | **Live**: an approved review with consent appears on `/reviews` in the same session |
| **Newsletter Interest** | Created from the newsletter form; no public list is shown |
| **Website Content → Blog** | **Live**: publishing an article makes it appear on `/blog` and `/blog/{slug}` in the same session |
| **Website Content → Services** | Preview-only. Public service pages keep the approved baseline (the editor says so explicitly) |
| **Website Content → Locations** | Preview-only in this build; public branch pages render the approved branches |
| **Website Content → Gallery** | Preview-only in this build; the public gallery and the home "A closer look" use the approved images |
| **Website Content → FAQs** | Preview-only in this build; the public FAQ page renders the approved list |
| **Website Content → Promotions** | Preview-only. The preview dialog notes the campaign "is not published anywhere"; the home banner is driven by separately approved campaign content |
| **Media Library** | Supplies images to Services, Blog and Gallery editors via the picker. Customer photos never appear here |
| **Settings** | **Live**: the accept-bookings toggle, pickup/express times and the newsletter toggle directly affect the public site (booking form, scheduling rules and the newsletter block) |

**In short:** bookings, enquiries, reviews, blog articles and settings are wired to the public site *within the session*; the generic Website Content modules (services, locations, gallery, FAQs, promotions) are fully functional admin workflows whose changes are held in the demo workspace and are intended to be connected to the public site during the backend phase.

---

## 9. Cross-cutting admin behaviours

- **Unsaved-changes guard**: when an editor has unsaved edits, following a link or closing the tab triggers a "You have unsaved changes. Leave this page?" dialog.
- **Optimistic concurrency**: if a record changed since you opened it (for example, after another action), saving shows a "changed while you were editing" message with a **Reload latest details** option.
- **Status/lifecycle rules** are enforced in one place, so the same rules apply whether you act from a list or a detail page.
- **Simulate failure**: the "Preview controls → Simulate next save failure" tool makes the next save fail once, to review error handling.
- **Empty, loading, error and permission states** all have designed screens (see `/preview`): loading skeletons, load error with retry, session expired, access denied, and record-not-found.

---

## 10. Demo data and reset

- Starting records: three sample bookings (Pending, Processing, Ready), the service catalogue, three branches, gallery images, FAQ list, and a marketing media library.
- Created during your session: any bookings, enquiries, quotes, reviews or newsletter interest you submit; any content, media or settings you change.
- **Reset**: refresh the browser (or sign out and back in) to restore the starting state.
- **Do not enter real customer data** — the demo banner and form footers repeat this.

---

## 11. Suggested test checklist

### Public
- [ ] Home hero looks calm and correct on a phone (static hero) and animates on a wide desktop screen.
- [ ] Home services and the Services page swipe on mobile with a next-card peek and dots; they are a grid on desktop.
- [ ] Home "A closer look" and the Gallery page show a peek slider with arrows on desktop; captions are hidden on mobile and visible in the image viewer.
- [ ] Book a Pickup: complete all four steps; try an invalid phone, a past date, and Express today after the cutoff.
- [ ] Submit a booking and copy the reference / WhatsApp draft.
- [ ] Submit a general enquiry, a commercial quote, a review and newsletter interest.
- [ ] Open the image viewer from the Gallery; test Previous/Next and the arrow keys.
- [ ] Switch theme (System / Light / Dark) from the menu and the footer.
- [ ] Visit `/preview`, `/page-that-does-not-exist`, and each policy page.

### Admin
- [ ] Enter the demo workspace from `/admin/login`; confirm `/admin/...` is blocked without a session.
- [ ] Dashboard metrics reflect the sample bookings/enquiries.
- [ ] Filter the bookings list; change status inline and from the detail page; confirm the arrangement requirements block a premature "Confirm".
- [ ] Add an internal note and cancel a booking with a reason.
- [ ] Mark an enquiry contacted, then closed.
- [ ] Approve a review, then check `/reviews`; try approving without consent.
- [ ] Publish a blog article, then check `/blog`.
- [ ] Edit and reorder FAQs; try duplicate questions.
- [ ] Add gallery images, reorder/hide them, and remove a placement (confirm the library asset remains).
- [ ] Upload media; try an oversized/unsupported file; try archiving an in-use asset.
- [ ] Turn off "Accept online pickup requests" and confirm the public booking form shows the paused panel.
- [ ] Edit a record, then click away to see the unsaved-changes dialog.
- [ ] Use "Simulate next save failure" and confirm the error and retry path.

---

## 12. Known limitations (expected for a frontend build)

- No authentication, database, email, SMS, payments or file storage — the API deliberately returns "not configured".
- Demo records are in memory and reset on refresh.
- Public Services, Locations, Gallery, FAQs and Promotions render from the approved code-managed content; console edits to those modules are preview-only until backend integration.
- Photography comes from design references — rights should be verified and final assets approved before launch.
- Policy bodies, final blog content and genuine customer reviews still need to be supplied.
- Newsletter sending is not connected.

---

## 13. Route index

### Public

```
/                               /commercial-laundry
/services                       /commercial-laundry/quote
/services/{slug}                /gallery
/how-it-works                   /blog
/locations                      /blog/{slug}
/locations/{slug}               /faq
/about                          /reviews
/contact                        /reviews/share
/book                           /privacy  /terms  /laundry-care-terms
/book?state=paused              /preview
```

### Administration

```
/admin                     /admin/content
/admin/login               /admin/content/services  (+ /{id}, /new)
/admin/reset-password      /admin/content/locations (+ /{id})
/admin/set-password        /admin/content/gallery
/admin/bookings            /admin/content/blog      (+ /{id}, /new)
/admin/bookings/{id}       /admin/content/faqs
/admin/enquiries           /admin/content/promotions(+ /{id}, /new)
/admin/enquiries/{id}      /admin/media
/admin/reviews             /admin/media/upload
/admin/newsletter          /admin/media/{id}
/admin/settings
```

Useful demo states: append `?state=empty`, `?state=loading`, `?state=error`, `?state=access-denied`, or `?state=session-expired` to the relevant admin address.

---

*Prepared for client review of the 2nd Wave Laundry Services frontend build. All data, submissions and edits in this build are simulated and reset on refresh.*
