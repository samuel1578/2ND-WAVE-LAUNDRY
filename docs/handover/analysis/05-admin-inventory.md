# Handover analysis 05 — Admin console feature inventory (input for the Admin Manual)

Snapshot taken 2026-11-13 at commit `f5940bc`. This was a read-only investigation, and it describes the live console only, not the demo workspace.

The labels in quotes are copied **exactly** from the components. Every claim cites `file:line`. Several messages wrap across lines in the source; they are quoted joined, and cited at their first line.

This doc builds on earlier ones and does not repeat them:
- Who can do what (Full Admin vs Operational Admin): [doc 04 §4](./04-database.md#4-roles-and-access-model).
- Booking statuses, allowed moves and which emails each move sends: [doc 04 §3](./04-database.md#3-booking-lifecycle).
- Upload rules for photos and media: [doc 04 §7](./04-database.md#7-storage).
- Email template contents: [doc 02 §6](./02-env-services-emails.md#6-brevo-template-map).

---

## 1. Access and account

| Screen | What the user sees | Source |
|---|---|---|
| **Sign in** `/admin/login` | Title "Admin Sign In"; text "Sign in with an administrator account. Access is limited to invited staff."; fields "Email address", "Password"; button "Sign In" (shows "Signing in…" while busy); link "Forgot Password?" | `src/components/admin/admin-app.tsx:107-114,510,521,548-554` |
| Sign-in errors | Wrong details, **or a disabled / no-role account:** "Those sign-in details were not accepted. Check your email address and password, then try again." Disabled accounts get the same generic message; the session is ended. Empty fields: "Enter your email address and password." | `src/lib/auth/actions.ts:31-32,96-127` |
| **Forgot password** `/admin/reset-password` | Title "Reset your password"; field "Email address"; button "Send Reset Link" ("Sending…"). The result is always "If this email is authorised, you’ll receive password reset instructions.", so it never reveals whether the address exists. The email is sent by Supabase Auth, not Brevo (doc 03 §4) | `admin-app.tsx:409,491,548-550`; `src/lib/auth/actions.ts:145-170` |
| **Set password** `/admin/set-password` (from a reset or invite link) | Title "Set new password", or "Accept invitation" for invites; fields "Password", "Confirm password"; help "Use at least 12 characters. Your password must match the confirmation above."; button "Save Password" ("Saving…"). Afterwards: "Your password has been updated." | `admin-app.tsx:412-413,521-548,329`; `src/lib/auth/roles.ts:13` |
| Password errors | "Your passwords do not match."; "Use at least 12 characters for your new password." | `admin-app.tsx:424`; `src/lib/auth/actions.ts:183-186` |
| **Expired or used link** | Invitation: title "Invitation link unavailable", body "Link expired. Ask an admin to resend your invitation." Reset: title "Reset link unavailable", body "This password reset link has expired, was already used, or the account is not an active administrator. Request a new link to continue." Buttons "Reset your password" and "Return to Sign In". The expiry time is a Supabase dashboard setting; the repo documents 3600 s (doc 03 §4) | `admin-app.tsx:463-477` |
| **Sign out** | "Sign Out" in the sidebar and the mobile menu | `src/components/shell.tsx:288,385` |
| **Session expiry** | A signed-out or expired visitor to any protected `/admin` page is redirected to `/admin/login?next=<page>`, with no message. After signing in they return to that page. The screen "Your session has expired." exists only as a demo preview state | `src/proxy.ts`; `src/app/admin/[[...segments]]/page.tsx:52-56`; `admin-app.tsx:262-268` |
| **Disabled admin** | Their next request is treated as signed out (redirect to sign-in), and sign-in fails with the generic message above. A Full Admin is told: "Existing Supabase sessions are not revoked at the provider, so sign that account out separately if you need to end them immediately." | `src/lib/auth/actions.ts:117-127`; `src/components/admin/staff-manager.tsx:837` |
| **Wrong role** (for example an Operational Admin opening `/admin/settings` directly) | Title "Access denied", body "Your administrator role does not include {area}. Ask a Full Admin if you need access to it." | `admin-app.tsx:142-146` |

**Operational vs Full Admin in the UI.** The sidebar is built from `adminNavigationFor(role)` (`admin-app.tsx:125`). Items a role cannot use are **hidden**, not greyed out:
- An Operational Admin sees only **Bookings** and **Reviews**, and lands on `/admin/bookings` after sign-in (`src/lib/auth/permissions.ts:39-45,244`).
- In a review, Operational Admins do not see the "Full Admin controls" panel (`src/components/admin/reviews.tsx:1134`).
- In a booking, they do not see the "Customer email delivery" panel, which needs `email.manage` (`admin-app.tsx:180`).

## 2. Navigation map

| Sidebar item | Route | Who | Purpose | Source |
|---|---|---|---|---|
| Dashboard | `/admin` | Full Admin | Counts and recent activity | `src/lib/auth/permissions.ts:109` |
| Bookings | `/admin/bookings` | Both | Pickup requests and their lifecycle | `:115` |
| Enquiries | `/admin/enquiries` | Full Admin | General enquiries and commercial quote requests | `:121` |
| Reviews | `/admin/reviews` | Both (Full Admin extras) | Moderate and publish customer reviews; replies | `:127` |
| Newsletter Interest | `/admin/newsletter` | Full Admin | List of newsletter opt-ins (view only) | `:133` |
| Website Content | `/admin/content` | Full Admin | Services, Locations, Gallery, Blog, FAQs, Promotions | `:139`; `src/components/admin/content/content-config.ts:2-7` |
| Media Library | `/admin/media` | Full Admin | Marketing images used across the website | `:145` |
| Settings | `/admin/settings` | Full Admin | Contact details, socials, booking pause, pickup rules, newsletter toggle, **order alert recipients** | `:151` |
| Staff Management | `/admin/staff` | Full Admin | Invite, change role, disable or restore admins | `:160` |
| Email Delivery | `/admin/email-delivery` | Full Admin | Email queue, test sends, retry and resend | `:166` |

Other UI: a theme switch ("System", "Light", "Dark", `src/components/shell.tsx:136-138`) and "Sign Out". The Content landing page notes "Homepage, About and Policy Pages are managed in code." (`src/components/admin/content/content-dashboard.tsx:47`).

**Unsaved-changes guard.** Settings and the content editors warn before you leave a page with unsaved changes: dialog "Unsaved changes", "You have unsaved changes. Leave this page?", buttons "Cancel" and "Leave Page" (`src/components/admin/unsaved.tsx:43-60`).

**Website save limit.** Every Website Content, Media and Settings save shares a limit of **5 saves per minute per admin** (`src/lib/security/rate-limit.ts:51`). Beyond it the save fails with "Too many website content writes. Wait before trying again." (`src/lib/website/write-guard.ts:33-37`).

---

## 3. Screens

### 3.1 Dashboard (`/admin`)
- **Purpose and access:** overview for Full Admins (`dashboard.read`).
- **List view:**
  - Tiles: "Pending bookings", "Active bookings", "New enquiries", "Reviews awaiting approval" (`admin-app.tsx:722-735`).
  - Sections "Recent bookings" and "Recent enquiries", each with "View All ↗" (`:775-802`); enquiry rows are tagged "Commercial quote" or "General enquiry" (`:811`).
  - "Console modules" links (`:825`).
  - Empty text: "No requests to show yet." (`:796,820`).
- **Forms / actions:** none beyond links.
- **Side effects:** none.
- **Errors:** "Booking totals could not be loaded. Reload the page and try again." (`:748`); "Enquiries could not be loaded." / "Reload the page and try again." (`:818`).

### 3.2 Bookings list (`/admin/bookings`)
- **Purpose and access:** all pickup requests; both roles (`bookings.read`). Heading "Bookings", description "Live requests persisted in the booking database." (`src/components/admin/bookings.tsx:764-765`).
- **Columns:** "Reference" (links to the detail page), "Customer", "Services", "Requested pickup" (with " · Express" for express requests), "Status" (badge), "Assigned branch" (`:868-873,898`).
  - A request with no preferred time shows "As soon as possible" (`src/lib/bookings/scheduling.ts:66`).
- **Filters:**
  - "Search bookings" searches reference, customer name and customer phone (`src/lib/bookings/admin.ts:251-253`).
  - "Status" ("All statuses"), "Assigned branch" ("All branches" / "Unassigned"), "Requested date".
  - Buttons "Search" and "Clear filters" (`bookings.tsx:777-842`).
- **Sort and paging:** newest first (`src/lib/bookings/admin-service.ts:174` region, `order created_at desc`); **20 per page** (`src/lib/bookings/admin.ts:30`); "Previous" / "Next" (`bookings.tsx:928-938`).
- **Empty states:** "No bookings match these filters." / "No bookings yet." (`:857-858`).
- **Errors:** "Bookings are unavailable" with "Try Again" (`:848-850`); "Bookings could not be loaded. Reload the page and try again." (`:742`).

### 3.3 Booking detail (`/admin/bookings/<id>`)
- **Purpose and access:** one booking; both roles (`bookings.manage` to change it). The header shows the reference, the customer name and a status badge; "← Bookings" goes back (`bookings.tsx:1202-1209`).
- **Read-only panels** (`:1226-1298`):
  - "Customer details": "Full name", "Phone number", "Email address", "WhatsApp", "Preferred contact method". Empty values show "Not provided".
  - "Customer email delivery", **Full Admin only**: the emails queued for this booking and their state. Shows "No customer email was queued for this booking." when there are none (`src/components/admin/email-delivery.tsx:456,475`).
  - "Laundry details": services (or "No services recorded."), item category, load size, " · Express/Same-Day", customer notes (or "No special requests.").
  - Customer photos: "Customer-attached image N". Click to open the viewer ("Zoom in", "Zoom out", "Reset to fit", "Close viewer"). Shows "No image attached to this booking." when there are none (`src/components/admin/booking-image-panel.tsx:125-127,153,294-304`).
    - **After 90 days** a photo shows "Unavailable" (`booking-image-panel.tsx:164`), because the database hides expired photos (doc 04 §7). Each opened image link lasts 10 minutes.
  - "Pickup request": "Address", "Landmark", "Date", "Preferred time", "Transport", "Map link".
  - "Cancellation" (only when cancelled): the reason, and "Cancelled {date/time}".
- **Form "Agreed arrangements"** (`:1301-1386`). The intro text reads: "Record the agreed branch, pickup time, fee and contact outcome before confirming. The agreed time must fall inside the 07:00–17:00 pickup window (Africa/Accra)."

  | Field (label) | Type / limit | Required for "Confirm Booking"? |
  |---|---|---|
  | "Assign branch" | dropdown, "Unassigned" + active branches | **Yes** |
  | "Agreed pickup date and time (Africa/Accra)" | date-time; must fall within the pickup window | **Yes** |
  | "Pickup fee (GHS)" | number ≥ 0, 2 decimals | **Yes** |
  | "Reason for zero fee" | text ≤ 2000 | **Yes, if the fee is 0** |
  | "Contact outcome" | text ≤ 2000 | **Yes** |
  | "Confirmation note" | text ≤ 2000 | **Yes** |
  | "Agreed return details" | text ≤ 2000 | No |

  Button "Save Agreed Arrangements" saves these fields with **no status change** and **no email**. Success message: "Agreed arrangements saved." (`src/lib/bookings/admin-actions.ts:171`).
- **Actions:**

  | Button / control | What it does | Confirmation | Source |
  |---|---|---|---|
  | "Update Status" dropdown ("Select next status") + button | Offers only the allowed next statuses (doc 04 §3), excluding Cancelled. The button reads "Confirm Booking" when Confirmed is chosen, otherwise "Update Status". **Sends emails immediately** (see side effects) | none | `bookings.tsx:1389-1411` |
  | "Add Note" (textarea ≤ 4000) | Adds an internal note. Staff only; never sent to the customer. ⚠️ **Notes cannot be edited or deleted** | none | `:1429-1446`; doc 04 §6 |
  | "Draft WhatsApp Update" | Opens a dialog with editable "Message", pre-filled: "Hello {name}. Your request {reference} is now marked {status}. Please contact us if you have any questions." Buttons "Open WhatsApp" (opens wa.me to the customer's WhatsApp, or their phone number if it is the same) and "Copy Message". Text: "Review this message before opening WhatsApp. You will send it manually." | none; nothing is sent automatically | `:1480-1577` |
  | "Cancel Booking" ⚠️ | Dialog "Cancel Booking" needs "Reason for cancellation" (≤ 2000). Buttons "Cancel Booking" / "Keep Booking". **Irreversible**: Cancelled is final. Emails the customer and staff | the dialog itself; there is no second "are you sure" | `:1491-1530` |

- **Side effects:**
  - Each status change immediately queues and sends emails (the customer gets an email only if they gave a valid address):

    | Move to | Customer receives | Staff alert list receives |
    |---|---|---|
    | Confirmed | Booking confirmed | — |
    | Scheduled, Picked Up, Out For Delivery | **nothing** | — |
    | Processing | Processing started | yes |
    | Ready | Laundry ready | yes |
    | Completed | Booking completed | yes |
    | Cancelled | Booking cancelled | yes |

    Mapping from doc 04 §3; dispatch at `admin-actions.ts:217`.
  - A new booking emails the customer "Booking received" and all alert recipients (doc 02 §6).
  - The public site is not affected.
- **Success messages:** "Booking cancelled." or "Status updated to {status}." (`admin-actions.ts:222-225`); "Note added." (`:258`).
- **Errors and conflicts** (messages from `src/lib/bookings/errors.ts:71-84`):
  - Version conflict: "This booking changed while you were editing it. Reload the latest details before saving." plus a "Reload latest details" button, which reloads without losing the page (`bookings.tsx:1210-1220`). **Recovery:** click it, re-enter your change, save again.
  - Confirming with missing fields: "Complete the agreed branch, pickup time, fee, contact outcome and confirmation note before confirming." (`:1120`), with per-field messages such as "Record the agreed pickup fee." (`src/lib/rules.ts:133-146`).
  - Time outside the window: "Choose an agreed pickup time between {start} and {end}." (`src/lib/bookings/admin.ts:574`); "Choose a valid agreed pickup date and time." (`bookings.tsx:1064`).
  - Other errors: "Enter a reason for cancellation."; "This status change is not allowed."; "Too many booking changes in a short time. Please wait a moment and try again." (limit 120 per 15 minutes, `src/lib/security/rate-limit.ts:33`).

### 3.4 Enquiries (`/admin/enquiries`)
- **Purpose and access:** public enquiry and commercial-quote forms; **Full Admin only** (`enquiries.manage`).
- **List view:**
  - Heading "Enquiries"; tabs "General enquiries" / "Commercial quotes"; "Search enquiries" searches every field (`src/components/admin/leads.tsx:239-257,236`).
  - Cards show the business or name, the message (or items), "Submitted {date}" and a status badge (`new`, `contacted`, `closed`, shown as stored).
  - Only the **newest 100 per tab** load (`src/lib/enquiries/repository.ts:68`); there is no paging.
  - Empty: "No enquiries to show yet." (`leads.tsx:284`).
- **Detail:**
  - Title "General Enquiry Detail" or "Commercial Quote Detail"; panel "Contact details & requirements" with "Submitted" and each submitted field; empty values show "Not provided" (`:161-179`).
  - "Internal notes" + "Add Note" (≤ 4000); notes cannot be deleted from the UI.
- **Actions:** "Add Note", "Mark Contacted", "Close Enquiry" (`:189-217`), with no confirmation. Success: "Enquiry updated." (`:142`).
- **Side effects:** no email to the enquirer on any action. The new-enquiry alert goes to the order alert list when the enquiry is submitted (doc 02 §6).
- **Errors:** "This enquiry could not be updated. Reload and try again." (`:136`); "Enquiries could not be loaded. Reload the page and try again." (`:112`).

### 3.5 Reviews (`/admin/reviews` and `/admin/reviews/<id>`)
- **Purpose and access:** customer reviews submitted on the website. Both roles can moderate, publish and reply; re-open and override are **Full Admin only**. Heading "Reviews", description "Customer review submissions, decisions and publication." (`src/components/admin/reviews.tsx:480-481`).
- **List view:**
  - Columns "Submitted", "Customer", "Rating" ("N / 5"), "Branch", "Status", "Publication" ("Published vN" / "Not published") (`:594-624`).
  - Filters "Search reviews", "Status" ("All statuses", "Pending", "Approved", "Rejected"), "Branch", "Rating" ("All ratings"), "Submitted from", "Submitted to"; buttons "Search", "Clear filters"; paging "Previous" / "Next" (`:493-651`).
  - Empty: "No reviews match these filters." / "No reviews yet." (`:583`).
- **Detail panels** (`:852-1013`):
  - "Original submission": "Rating", "Branch", "Publication permission" ("Recorded (notice …)" or "Not recorded — this review cannot be published"), "Submitted", "Decided".
  - "Reply", "Public version", "History".
- **Forms:**
  - "Reply draft" / "New reply draft" (≤ 4000). Help: "Plain text. A reply is public only after it is published under an approved, published review." (`:911-915`).
  - Publish dialog field "Public text", help "Rendered as plain text. The original submission is not changed." (`:1244-1246`).
- **Actions:**

  | Button | Who | Effect | Confirmation text | Source |
  |---|---|---|---|---|
  | "Approve Review" | Both | Approves; allows publication. Text: "Decisions are final for this role; a Full Admin can re-open a rejection or override a decision." | none | `:1037-1057` |
  | "Reject Review" | Both | Needs "Reason for rejection": "A recorded reason is required before a review can be rejected." Buttons "Reject Review" / "Keep Review" | dialog | `:1170-1215` |
  | "Publish Review" | Both | Publishes an editable public text (original kept) | dialog with "Public text"; buttons "Publish Review" / "Cancel" | `:1112-1121,1224-1277` |
  | "Edit Public Version" | Both | Saves a new public version ("Save New Version") | dialog | `:1097,1270` |
  | "Unpublish" ⚠️ | Both | "The review will be removed from the public site immediately. The original submission and its history are retained." Buttons "Unpublish Review" / "Keep Published" | dialog | `:1286-1317` |
  | "Save Draft" (reply) | Both | Saves a reply draft, not public: "A reply draft is saved and is not visible publicly." | none | `:903,948` |
  | "Publish Saved Draft" (reply) | Both | Makes the reply public. Only possible when "The review must be approved and published before its reply can be published." Replacing a published reply: "Replacing a published reply creates a draft and retains the previous published text." | none | `:970-982` |
  | "Re-open for Moderation" | **Full Admin** | "The review returns to the pending queue and its decision is cleared. A reason is required and is recorded in the history." Field "Reason for re-opening"; button "Re-open Review" | dialog | `:1146,1325-1368` |
  | "Override Review" ⚠️ | **Full Admin** | "Overrides are reserved for emergencies. The action, your account and the reason are written to the immutable audit history." Field "Override operation": "Force approval", "Force publication", "Force unpublish". Fields "Public text", "Reason for override"; button "Apply Override" | dialog | `:1150-1160,1376-1463` |

- **Side effects:** **no emails** are sent for reviews (no review email templates exist; doc 02 §6). Publishing and unpublishing change the public Reviews page. The UI says unpublishing is immediate (`:1289`); the public page refresh timing was not verified (Unknowns).
  - ⚠️ Saved **draft** replies can be read through the public database API (doc 04 §5). Don't put anything private in a reply draft.
- **Success messages:** "Review approved." / "Review rejected." / "Review published." / "Review unpublished." / "Public version updated." / "Review re-opened for moderation." / "Reply draft saved." / "Reply published." / "Override applied and recorded in the review history." (`src/lib/reviews/actions.ts:164-349`).
- **Errors and conflicts:** "This review changed while you were viewing it. Reload the latest details before saving." with a "Reload latest details" button (`src/lib/reviews/errors.ts:60`; `reviews.tsx:844`). Also: "Record a reason before rejecting a review."; "Enter a reply between 1 and 4000 characters."; "Publication permission was not recorded, so this review cannot be published."; "Approve the review before publishing it." (`errors.ts:54-59`; `reviews.tsx:1127-1128`).

### 3.6 Newsletter Interest (`/admin/newsletter`)
- **Purpose and access:** list of people who opted in to the newsletter; **Full Admin**. Heading "Newsletter Interest", description "Email campaigns and provider integration are not enabled." (`leads.tsx:389-390`).
- **List view:** columns "Email address", "Consent", "Recorded date", "Status", "Actions" ("View Details") (`:401-424`). Empty: "No newsletter interest recorded yet." (`:433`).
- **Actions:** "View Details" only. The live dialog says "Withdrawal and campaign controls are not part of this phase." (`:485`). The "Record Withdrawal" button exists only in the demo (`:463`).
- **Side effects:** none. The sign-up alert to `manager@2ndwavelaundry.com` is sent at submission (doc 02 §6).

### 3.7 Website Content (`/admin/content`)
**Access:** Full Admin (`content.manage`). Landing cards: "Manage Services", "Manage Locations", "Manage Gallery", "Manage Articles", "Manage FAQs", "Manage Promotions" (`src/components/admin/content/content-config.ts:23-70`).

**How fast changes appear:** saves expire the public cache immediately (`updateTag` + `revalidatePath`), so changes show **on the next page load** (`src/lib/website/revalidation.ts:7-12`; `src/lib/website/actions.ts`). The background cache refresh is 300 s (`src/lib/website/public.ts:68`). Reviews have their own "Go to Reviews" link (`src/components/admin/content/shared/module-shell.tsx:68-75`).

#### 3.7.1 Blog
- **List:**
  - Heading "Blog", "Draft changes remain private until published."
  - Each row shows the title, state ("Draft", "Published", "Published · draft changes", "Archived"), "Move up" / "Move down" and "Delete". Order is saved automatically: "Article order saved."
  - Empty: "No articles yet. Create a draft to get started." (`src/components/admin/content/blog-manager.tsx:144,179-246`).
- **Form** (title "Create Blog Article" / "Edit Blog Article"):
  - "Title *"; "Website URL / slug" (≤ 254); "Summary *" (≤ 2000, "A short summary that appears in the blog list and previews.").
  - Featured image (optional; "Featured image alt text *" is required once an image is set); "Author name" (≤ 160); "Biography" (≤ 2000); author profile image; "Make this article public" / "Article is live" toggle (`:479-564`).
  - The body is a canvas editor: "Write directly in the canvas. Insert an image wherever the cursor is, then select it to edit its alternative text, caption, alignment and display size."
    - Inserted images need "Alternative text *" (≤ 1000) and take "Caption (optional)", "Alignment" (Left/Center/Right) and "Display size" (Small/Medium/Large/Full width).
    - Links must be http(s) or mailto (`src/components/admin/content/blog-editor.tsx:56-65,590-593,972-1017`).
    - "The featured image is optional and separate from the body… HTML is never executed." (`blog-manager.tsx:509`).
- **Actions:**
  - Save draft: "Draft saved."
  - Publish: "Publish this article?" / "It will become visible on the website." → "Article published."
  - Unpublish → "Article unpublished. The draft is retained."
  - Archive: "Archive this article?" / "It will be removed from the website." → "Article archived."
  - ⚠️ **Delete Article:** "Permanently delete “{title}”? It is removed from the website and from this article list. Images used by this article stay in the Media Library, because other content may still use them." Buttons "Cancel" / "Delete Article". Result: "“{title}” was permanently deleted." **Irreversible** (direct database delete, doc 04 §4).
  - Source: `blog-manager.tsx:164,254-279,382-387,603-621`.
- **Errors:** "That article slug is already in use. Choose a different title."; "Choose images from the active Media Library before saving this article." (`src/lib/website/repository.ts:192,198`).

#### 3.7.2 FAQs
- **List and form** (one page):
  - Heading "FAQs", description "Questions and answers shown on the public FAQ page. Reorder, enable or disable individual entries. Add FAQs to manage the full collection."
  - Each FAQ has "Question *" (≤ 300) and "Answer *" (≤ 4000), with buttons "Edit", "Move Up", "Move Down", "Disable FAQ" / "Enable FAQ" and "Delete" (`src/components/admin/content/faq-manager.tsx:97-218`).
  - **Branded glow:** "Make the answer first. Write the complete answer your customer should read. Then select the exact words you want to highlight and apply the branded glow." Button "Apply branded glow to selected words" (`:134-164`).
- **Save model:** nothing is saved until "Save Changes" → "Changes saved." Deleting asks "Delete this FAQ?" / "Remove this question and answer from the collection? Save Changes to keep the removal." (`:85,233-257`).
- **Errors:** "Every FAQ needs a question." / "Every FAQ needs an answer." / "Questions must be unique." (`src/lib/rules.ts:307-312`). Conflict: "FAQs changed while editing. The latest saved version is different; reload the page before trying again." (`src/lib/website/repository.ts:133`).

#### 3.7.3 Promotions
- **List:**
  - Heading "Promotions", "Time-boxed campaign records for the admin workspace. Drafts stay here until activated."; button "New Promotion".
  - Empty: "No promotions yet." (`src/components/admin/content/promotions-manager.tsx:77-113`).
  - States: Draft / Scheduled / Active / Paused / Ended (`src/lib/rules.ts:256-262`).
- **Form:**

  | Field | Limit / help |
  |---|---|
  | "Name (only you see this) *" | ≤ 200. "Use a short name so your team can find this offer later." |
  | "Headline customers will see *" | ≤ 200 |
  | "Offer details *" | ≤ 4000 |
  | "Terms and conditions" | ≤ 4000 |
  | "What’s not included" | ≤ 4000 |
  | "Attached service (optional)" | dropdown |
  | "Button wording" | ≤ 80. "Optional. If you add this, choose a button link below too." |
  | "Button link" / "Website link" | ≤ 500. Both or neither: "Add both a button label and a link, or leave both fields empty." |
  | "Promotion image" | JPEG/PNG/WebP, optimised in the browser (see §3.8), **max 2 MB** after optimisation (`src/lib/website/promotion-image.ts:5`). "Image alt text *" is "Required when an image is set." |
  | "Starts on *" | "When customers can begin using the offer." |
  | "Ends on *" | "The offer ends at the start of this date." |
  | "Order when several offers are active" | "Lower numbers appear first in the About-page offer list." |
  | "Show this offer on the website" | checkbox |
  | "I have checked the offer dates" | checkbox. Rule: "Confirm the offer dates with the client before activation." |

  Source: `promotions-manager.tsx:296-474`; `src/lib/rules.ts:326-338`.
- **Actions:**
  - "Save Changes" → "Changes saved."
  - "Preview": "Preview only. This campaign is not published anywhere."
  - "Activate", "Pause", "Resume", "End Promotion" → "Promotion activated." / "Promotion paused." / "Promotion resumed." / "Promotion ended." These are enabled only after saving, with no unsaved changes (`:233-257,275,479-527`).
  - "Delete Draft": in the live console "Live drafts cannot be deleted here. Clear the draft fields and save it as a draft." (`:214`).
- **Side effects:** active promotions appear on the public **About** page (`src/app/[...slug]/page.tsx:298-300`).

#### 3.7.4 Services
- **List:**
  - Heading "Services", "Catalogue records for each public service. Published services appear on the public website."; button "New Service".
  - States "Draft", "Published", "Archived".
  - Empty: "No services yet. Create a draft to get started." / "Published services appear on the public website and in the booking catalogue." (`src/components/admin/content/services-manager.tsx:114-171`).
- **Form:**
  - "Title *"; "Slug *" (lowercase, numbers, hyphens); "Summary *"; "Body" (≤ 50,000, "Plain text with paragraph breaks. HTML is not executed. New services display this body on their public page."); "Sort order".
  - Featured image from the Media Library ("Select from Media Library"), with "Alt text *" required to publish (`:401-457`).
- **Validation:** "Enter a title for this service." / "Enter a slug for this service." / "Use lowercase letters, numbers and hyphens for the slug." / "Add a summary before publishing this service." / "Add alt text to the featured image before publishing." (`:287-294`).
- **Actions:**
  - "Save Draft" → "Draft saved."
  - "Publish": "Publish this service?" / "The service will become visible on the public website." → "Service published."
  - "Unpublish" → "Service unpublished. The record is retained."
  - "Archive" → "Service archived."
  - "Save changes" → "Changes saved. The published service is up to date."
  - ⚠️ **"Delete Service":** "Permanently remove “{title}” from the public website and this service list? A service that existing bookings still reference cannot be deleted and must be archived instead." Plus "If bookings still reference this service, the delete is refused and the service must be archived instead, so booking history is never changed." **Irreversible.**
  - Source: `:186,316-323,575-610`.
- **Side effects:** published services appear on `/services`, on their own page, and in the public **booking form catalogue** (`:171`).
- **Errors:** "That service slug is already in use. Choose a different slug."; "Service changed while editing. Reload the latest details and try again." (`src/lib/website/repository.ts:351-356`).

#### 3.7.5 Locations
- **List:** heading "Locations", "The three documented branches. Branches cannot be created or deleted here."; per branch "Edit Branch" and "View Public Page" (`src/components/admin/content/locations-manager.tsx:43-85`).
- **Form:**
  - "Branch name *" (≤ 120); "Branch label" (≤ 120, "Shown as a badge on the branch card when provided."); "Phone number *" (≤ 40).
  - "Map URL" (≤ 500, "Leave empty when the branch has no map link."; Google or Apple Maps links only).
  - Opening-hours rows ("Row N label", "Row N hours", each ≤ 80; "Add Opening Hours Row", "Remove"); "Sort order" (`:147-237`).
- **Validation:** "Enter the branch name."; "Use a recognised Google or Apple Maps link."; "Use opening-hour ranges such as 7am–8pm." (`src/lib/rules.ts:282-290`). Conflict: "Branch changed or could not be saved. Reload and try again." (`repository.ts:254`).
- **Side effects:** updates the public `/locations` pages. These are **display hours only**. Pickup windows are separate and cannot be edited in the UI (doc 04 §3).

#### 3.7.6 Gallery
- **Purpose:** heading "Gallery", "Start with a category, then manage only the images assigned to it." (`src/components/admin/content/gallery-manager.tsx:612-613`).
- **Categories:**
  - Fields "Category name *" (≤ 80) and "Description (optional)" (≤ 300); "Category shown on website" / "Category hidden from website".
  - "Open Category", "Move Up" / "Move Down" or drag; "Undo category move". Category order saves immediately: "Category order saved successfully." (`:256,685-823`).
- **Images in a category:**
  - "Add Images" picks from the Media Library.
  - Per image: "Image description *" (≤ 300), "Caption" (≤ 300), "Show this image on the website", "Move Up" / "Move Down", "Remove from Category".
  - "Save Changes" → "Changes saved. The website gallery now matches this view." (`:456,515-597`).
- **Dialogs:**
  - "Remove this image?" / "Remove {image}? The Media Library asset and its other category assignments will stay unchanged." Buttons "Keep Image" / "Remove Image".
  - "Delete this category?" / "{name} contains N image assignments. Deleting the category removes only its category assignments. Media Library assets and other category assignments are not deleted." Buttons "Keep Category" / "Delete Category" (`:880-900`).
- **Errors:** "Save or cancel other Gallery edits before changing category order."; "Category order could not be saved. Previous order restored." (`:229,264`).

### 3.8 Media Library (`/admin/media`)
- **Purpose and access:** marketing images; **Full Admin** (`media.manage`). The notice reads "Marketing assets only. Customer booking photos remain strictly private and are never displayed in the marketing library." (`src/components/admin/media-admin.tsx:45-53`).
- **List:** "Search media" (name + alt text); cards tagged "In use" / "Available". Empty: "No marketing media uploaded yet." Archived items are hidden (`:41,59-81`).
- **Upload / edit form** (title "Media Upload" / "Media Details"):
  - "Select file" / "Replace Media"; accepted types WebP, JPEG, PNG.
  - On-screen text: "Supported formats: WebP, JPEG, PNG · Maximum file size: 5MB per file".
  - Fields "Alt text *" (≤ 1000, **required**) and "Caption" (≤ 1000). Typing a caption also fills an empty alt text.
  - Progress messages "Optimizing…", "Uploading…", "Saving…"; "Cancel Upload" (`:220-291`).
  - Source: `media-admin.tsx:233-242`; `src/app/api/admin/website-media/route.ts:17,58`.
- **⚠️ Real size rules differ from the on-screen text:**
  - Images over 1.5 MB or wider/taller than **2000 px** are resized to a longest edge of 2000 px and converted to **WebP** (quality 0.85) in the browser.
  - The server rejects anything over **4 MB**: "Images must be 4 MB or smaller." (`src/lib/images/optimize.ts:1-3,16-40`).
  - Picker in the content editors: "WebP, JPEG or PNG · up to 5 MB each.", "Upload up to 6 images at a time." (`src/components/admin/content/shared/media-library-picker.tsx:216,310`).
- **Actions:**
  - "Upload Media" / "Save Changes" → "Changes saved."
  - "Archive Media": hides the asset from the library. It is refused while used by blog content: "This media asset is in use by Blog content. Replace its references before archiving or changing its URL."
  - ⚠️ **"Delete Media":** dialog "Delete Media" / "Permanently remove this asset from the library?" with "Cancel" / "Delete Media". Refused while in use: "This media asset is in use on the website. Remove its references before deleting it." / "This media asset is used in the website gallery. Remove it from the gallery before deleting it." **Irreversible** (`media-admin.tsx:313-347`; `src/lib/website/repository.ts:377-421`).
- **Side effects:** images are served publicly from the `marketing-assets` storage bucket (doc 04 §7).

### 3.9 Settings (`/admin/settings`)
- **Purpose and access:** **Full Admin** (`settings.manage`). A badge shows "Loading" / "Unsaved changes" / "Saved" (`src/components/admin/settings.tsx:174-177`).
- **Fields and effects:**

  | Section | Field (label) | Help / effect | Source |
  |---|---|---|---|
  | "Business details" | "Business email" | "Leave unset until the real business email is confirmed." Shown on the public site | `:208-217` |
  | "Contacts and social links" | "Main phone", "Main WhatsApp", "Instagram URL", "TikTok URL", "Facebook URL" | Socials: "Shown in the website footer. Leave empty to hide it." Must be https | `:220-254` |
  | "Booking requests" | ☐ "Accept online pickup requests" | Unticking pauses the public booking form. Customers then see "Online pickup requests are paused for now. Your details are still here." (`src/lib/bookings/errors.ts:57`) | `:257-268` |
  | "Pickup rules" | "Pickup start time", "Pickup end time", "Express pickup cutoff" | Sets the window and cutoff the **database** uses for new requests (doc 04 §3). Text: "For Express/Same-Day Laundry requiring collection, request pickup by {cutoff} for same-day service. The team confirms availability, the fee and timing for your items." | `:271-293` |
  | "Retention" | "Booking record retention" = "12 calendar months"; "Customer photo retention" = "90 days" (read-only) | "Booking records expire after 12 calendar months from creation; customer photos expire after 90 days from upload." **Display only: no deletion job exists** (doc 04 §11) | `:296-314` |
  | "Newsletter interest" | ☐ "Enable newsletter interest" | Shows or hides the public sign-up. If the server switch is off: "Newsletter sign-ups are switched off at server level. This setting has no effect until they are enabled." | `:317-336` |

- **Actions:**
  - "Save Settings" → "Settings saved.". "Cancel" reverts unsaved edits.
  - Unticking "Accept online pickup requests" opens the dialog "Pause new online requests?" / "Existing requests remain available." with "Cancel" / "Pause Requests" (`:338-373`).
- **Validation:** "Enter a valid email address."; "Enter a valid phone number."; "Enter valid HTTPS social links or leave them empty."; "Pickup start time must be before the express cutoff and pickup end time." (`src/lib/website/settings-validation.ts:67-85`). Conflict: "Settings could not be saved. Reload the latest values and try again." (`src/lib/website/repository.ts:248`).
- **Side effects:** changes the site-wide layout on the next page load (`src/lib/website/actions.ts:287-297`).
- ⚠️ **Inconsistency:** the booking detail screen always says "07:00–17:00", and its browser-side check uses the fixed default window (`bookings.tsx:1305`; `src/lib/bookings/admin.ts:553`). The database applies the saved Settings hours, or branch-specific windows. If Settings hours change, the admin hint and pre-check will not match the real rule.
- **Order alert recipients** (panel on this page): see §6.

### 3.10 Staff Management (`/admin/staff`)
See §5.

### 3.11 Email Delivery (`/admin/email-delivery`)
See §7.

---

## 4. Booking workflow, step by step (what staff experience)

1. **A new booking arrives.**
   - The customer has submitted the public form, so the booking is **Pending**.
   - Every address on the alert list gets "Staff alert — order pending", with a **"VIEW ORDER"** button linking to `/admin/bookings/<id>` (sign-in required).
   - If the customer gave an email, they receive "Booking received" (doc 02 §6; `docs/emails/staff/01-order-pending.html`).
   - **Public-form rules the customer met:**
     - Pickup date today or later.
     - Preferred time inside the pickup window (default 07:00–17:00).
     - Same-day requests refused after the window closes: "Pickup hours have ended for today. Choose another date or contact the team."
     - Express same-day refused after the cutoff (default 11:00): "The {cutoff} cutoff for express orders requiring pickup for service today has passed. Choose another date or contact the team to discuss your request."
     - Sources: `src/lib/rules.ts:64-80`; doc 04 §3.
2. **Review the booking.** Open it from the email link or the Bookings list. Check the customer details, laundry details, photos and pickup request. Contact the customer by phone, or use "Draft WhatsApp Update" → "Open WhatsApp" (manual).
3. **Record the arrangement** in "Agreed arrangements": branch, agreed date and time, fee (plus a zero-fee reason if 0), contact outcome, confirmation note, and optionally return details. Click **"Save Agreed Arrangements"**. Nothing is emailed.
4. **Confirm.** In "Update Status" choose "Confirmed", then **"Confirm Booking"**. All five required fields must be complete (§3.3). The customer gets **"Booking confirmed"**; staff get nothing.
5. **Move through the lifecycle** with "Update Status". Only the allowed next steps are offered:
   - Scheduled → Picked Up: **no emails**.
   - Processing: customer "Processing started" + staff alert.
   - Ready: customer "Laundry ready" + staff alert.
   - Out For Delivery: **no email**.
   - Completed: customer "Booking completed" + staff alert.
6. **Cancel** (any time before Completed) with "Cancel Booking" and a reason. Customer "Booking cancelled" + staff alert. ⚠️ Final.
7. **Notes:** "Add Note" at any time. Notes are internal, permanent, and never emailed.
8. **Photos:** visible for **90 days** after upload, then shown as "Unavailable".
9. **If someone else changed the booking first**, you see the version-conflict message: click "Reload latest details" and redo the change (§3.3).

## 5. Staff management (`/admin/staff`, Full Admin)

- **Header:** "Staff Management", "Invite administrators, manage roles and suspend or restore access. Every change is recorded in the audit log." (`src/components/admin/staff-manager.tsx:416-417`).
- **Invite:** section "Invite an administrator".
  - Text: "The invitation email is sent by Supabase Auth from the server only. The invitee gains no access until they accept the invitation and their staff profile is created from the invited role."
  - Fields "Email address" ("The address that will receive the invitation link.") and "Role" ("Operational Admin" / "Full Admin"); button "Send Invitation".
  - Success: "Invitation sent to {email} as {role}." (`:436-474`; `src/lib/admin/staff-actions.ts:149`).
- **What the invitee receives:**
  - A Supabase Auth email (template configured in the Supabase dashboard; doc 03 §4).
  - The link opens "Accept invitation", where they set a password of at least 12 characters.
  - An expired link shows "Link expired. Ask an admin to resend your invitation." (§1).
- **Accounts table:**
  - Columns "Administrator", "Role", "Status", "Added", "Actions"; your own row is marked "You" (`:520-540`).
  - Buttons "Change role" and "Disable" / "Restore".
  - "For your own account the actions are disabled: role changes, suspension and restoration always require a different Full Admin, so no one can escalate their own privileges." (`:593-597`).
- **Change role:** dialog "Change role for {name}".
  - Fields "New role" and "Reason (recorded in the audit log)" ("Required: at least 3 characters.", ≤ 200).
  - Promoting to Full Admin also needs the tick "I confirm this account should receive full administrative access to every console module."
  - Button "Change Role" → "Role updated to {role}." (`:753-814`; `staff-actions.ts:279`).
- **Disable / Restore** ⚠️: dialog "Disable {name}?" / "Restore {name}?".
  - Disable explains: "Disabling keeps the profile and its history but removes all access: their next verified request is rejected. Existing Supabase sessions are not revoked at the provider, so sign that account out separately if you need to end them immediately."
  - Restore explains: "Restoring clears the disabled state and returns the account to its existing role. No new role is assigned."
  - Both need a reason and a tick: "I understand this account will lose access until it is restored." / "I confirm this account should regain access with its existing role."
  - Buttons "Disable Account" / "Restore Account" → "Account disabled. Their next verified request will be rejected." / "Account restored with its existing role." (`:826-881`; `staff-actions.ts:329-330`).
- **Last Full Admin protection:** "The last active Full Admin cannot be removed. Add another Full Admin first." (`src/lib/admin/staff.ts:75`). This is enforced in the database (doc 04 §5).
- **Invitations list** ("Show invitations" / "Hide invitations"):
  - Statuses "Not yet sent", "Awaiting acceptance", "Accepted" (badge "Active"), "Failed", "Revoked".
  - Awaiting invitations have "Resend" ("Invite resent to {email}.") and "Cancel" (`:603-690`; `staff-actions.ts:215`).
  - Cancel dialog: "Cancel invitation for {email}?" / "This will mark the invitation revoked. An Auth user is deleted only if the server confirms it is unconfirmed, has never signed in, and has no administrator profile. Confirmed or active accounts are never deleted." Buttons "Keep Invitation" / "Cancel Invitation" (`:890-915`).
  - The "Expired" label exists in code (`:85`), but no invitation can have that status in the database, so it never appears (doc 04 §1, `admin_invitations_status_check`).
- **"Recent account activity":** load on demand ("Load activity"). Columns "When", "Action", "Account", "Detail" (`:708-725`).
- **Errors:**
  - "Too many attempts. Wait a few minutes and try again." (10 invites / 30 changes per 15 min; `src/lib/security/rate-limit.ts:28-29`).
  - "An invitation for that address is already outstanding."
  - "For your own account, ask another Full Admin to make this change."
  - "Another administrator changed this account. Reload the page and try again." (`staff.ts:57-86`).

## 6. Order alert recipients (Settings page, Full Admin)

- **Panel:** "Order alert recipients" (`src/components/admin/booking-alert-recipients.tsx:89-91`). Its texts:
  - "Every pending, processing, ready, completed and cancelled order alert is sent to every address on this list. This is one central list for the whole application; there are no per-order recipients."
  - "Changes apply to subsequent alerts only. Notifications already queued or sent are never resent. Each address receives its own copy, so recipients do not see one another's addresses." (`:257-264`).
- **Cap:** **10 enabled addresses** (`src/lib/email/recipient-rules.ts:14`; DB trigger `supabase/migrations/20261022120000_booking_alert_recipients.sql:138`). The counter reads "All five order alerts go to every enabled address here. {n} of 10 used." (`:401`). At the limit: "At most 10 addresses can receive order alerts. Remove one first."
- **Actions:**
  - "Add an email address" + "Add recipient".
  - "Edit" ("Save address" / "Cancel").
  - "Remove", with a browser confirmation: "Remove {email} from order alert recipients? It will not receive future staff alerts." Result: "Recipient removed. It will not receive future order alerts." (`:203,335-394`; `src/lib/email/recipient-actions.ts:158`).
  - There is no enable/disable toggle in the UI.
- **Empty list:** "No alert recipients are configured. Staff order alerts will not be sent until at least one address is added." (`:293`).
- **What recipients receive:** the five staff order alerts, each with a VIEW ORDER link (doc 02 §6).
  - ⚠️ They **also receive every new enquiry alert** ("Enquiry — new submission"). The panel text does not mention this (`supabase/migrations/20261103130000_enquiry_alert_recipients.sql:1-12`).
- **Errors:** "That address is already on the alert list."; "Another administrator changed this list. Reload and try again."; "Too many changes. Wait a few minutes and try again." (`recipient-rules.ts:48-52`).

## 7. Email Delivery (`/admin/email-delivery`, Full Admin)

- **Header:** "Email Delivery", "Customer notifications and their current delivery evidence." Explanation: "“Accepted by provider” means Brevo accepted the request, not that it reached an inbox. Delivered status appears only after an authenticated Brevo delivery event. One-off administrator messages are sent by the owner through Gmail Send As, not from this application." (`src/components/admin/email-delivery.tsx:210-216`).
- **Configuration panel:** "Transactional email configuration".
  - Status rows: "Transactional sending", "Brevo API key", "Site URL", "Worker secret", "Vercel cron secret", "Brevo webhook secret", "Controlled test recipient". Each shows "Enabled"/"Disabled" or "Configured"/"Missing (or invalid)".
  - The list "Saved Brevo template IDs" shows status only, never the IDs (`:220-234`).
- **Send test:** "Send controlled template test".
  - Pick a template; unconfigured ones show " — not configured". Button "Send template test".
  - It goes **only** to the server-configured `EMAIL_TEST_RECIPIENT`: "Set the server-only EMAIL_TEST_RECIPIENT to enable controlled tests. No customer recipient is accepted by the test API."
  - Result: "A controlled test was queued to the configured test recipient." Newsletter and enquiry templates cannot be tested (`:243-254,146`; doc 02 §6).
- **Queue list:**
  - Filters "Queue status": "All queue states", "Queued", "Sending", "Accepted by provider", "Retry scheduled", "Terminal failure". "Notification type": "All notification types" plus the 13 template names, for example "Booking received", "Staff alert — order pending", "Enquiry — new submission" (`:59-64,286-294`; `src/lib/email/monitoring.ts:196-208`).
  - Each row shows "Recipient", "Queue state", "Attempts", "Last attempt", "Accepted by provider", "Next attempt" and "Latest provider event", plus the error or bounce reason, highlighted red if dead or bounced. A row marked "Controlled template test" is a test send (`:329-366`).
  - Paging "Previous" / "Next"; empty "No notifications match these filters." (`:407-422`).
- **Actions:**

  | Button | Shown when | Prompt | Effect | Source |
  |---|---|---|---|---|
  | "Deliberately resend" | Row is "Accepted by provider" (sent) and not a test | Browser prompt "Why should {template} for {reference} be deliberately resent?" A reason is required | Queues a **new copy to the same recipient** and logs the reason. "A deliberate resend was queued and recorded in the audit log." ⚠️ The customer gets the email again | `:153-173,378-380` |
  | "Queue one retry" | Row is "Terminal failure" (dead) and under 20 attempts | Browser confirmation "Queue one additional delivery attempt for {reference} ({template})?" | One more attempt. "The failed notification was queued for another attempt." | `:180-199,383-389` |
  | (no button) | Dead and at the attempt cap | — | "Retry limit reached. Review the sender or provider issue before taking further action." | `:394` |

- **What staff should do with bounced or dead rows** (from the code's behaviour):
  - Read the error or bounce reason on the row.
  - A **bounce** usually means a wrong customer address. Retrying does not help; contact the customer by phone or WhatsApp from the booking.
  - A **Terminal failure** that is not a bounce can be retried once with "Queue one retry".
  - Repeated failures point to configuration, so check the status panel and escalate.
  - Limit: 10 retries and 10 sends per 15 min (`src/lib/security/rate-limit.ts:34-35`).
- **Per-booking view:** the same information appears on each booking as "Customer email delivery" (§3.3), linking to "View delivery monitor" (`:456-480`).

## 8. Settings summary
See §3.9 for every field, its effect and the exact retention text.

## 9. Gotchas for non-technical staff

1. **Status buttons email the customer immediately.** This applies to Confirmed, Processing, Ready, Completed and Cancelled, and there is no undo or "unsend". Scheduled, Picked Up and Out For Delivery send nothing (§3.3).
2. **Cancelled and Completed are final.** There is no way back, and bookings can never be deleted, even test bookings (doc 04 §6).
3. **Internal notes are permanent.** They cannot be edited or deleted, so never write anything you wouldn't want kept.
4. **"Save Agreed Arrangements" does not confirm.** You must also choose "Confirmed" and click "Confirm Booking".
5. **WhatsApp updates are manual.** "Open WhatsApp" only prepares the message; you press send in WhatsApp.
6. **"Deliberately resend" sends the customer a duplicate.** Use it only when they say they did not get it.
7. **Permanent deletes:** Delete Article, Delete Service and Delete Media cannot be undone. Prefer Archive or Unpublish.
8. **Pausing bookings** ("Accept online pickup requests" off) stops all new public requests until you tick it again.
9. **Images:** use JPEG, PNG or WebP.
   - Large images are shrunk to 2000 px and converted to WebP automatically.
   - Keep files under 4 MB (Media Library), or under 2 MB for promotion images. The screen says 5 MB, which is wrong.
   - Always fill in alt text.
10. **Five website saves per minute.** Rapid edits trigger "Too many website content writes. Wait before trying again."; wait a minute.
11. **"Someone else changed this" messages:** click "Reload latest details", then redo your change. Don't keep pressing Save.
12. **Alert list:** at most 10 addresses. Everyone on it also gets new enquiry alerts.
13. **Disabling a staff member** doesn't kick out a session that is already open. Ask a technical admin to end it if it's urgent.
14. **The pickup hours shown on the booking screen are fixed at 07:00–17:00,** even if Settings were changed (§3.9).
15. **Review reply drafts** should never contain private information (doc 04 §5).
16. **Don't test with real customers' details.** Test emails go only to the configured test address, but a test booking on the live site emails real staff, and the customer if an email is entered.

---

## Unknowns — needs Samuel

1. **Public page refresh timing for reviews:** review actions refresh only admin pages (`src/lib/reviews/actions.ts:124-126`). How quickly does the public Reviews page reflect a publish or unpublish? The UI promises "immediately". Needs a live check.
2. **Supabase Auth email templates and OTP expiry** (invite and reset wording, link lifetime): dashboard-only (doc 03 §4).
3. **Media size limit:** should the on-screen "5MB" text be corrected to 4 MB (2 MB for promotions)?
4. **Pickup-hours hint:** should the booking screen use the saved Settings hours instead of the fixed 07:00–17:00 text and check?
5. **Enquiry status labels** show raw values (`new`, `contacted`, `closed`). Are friendlier labels wanted for the manual?
6. **Enquiries beyond 100 per tab** are not reachable in the UI. Is that acceptable?
7. **Newsletter withdrawal:** customers asking to be removed have no admin action. What is the manual process?
8. **Branch pickup windows and exceptions** (holidays, closures) cannot be set in the UI. Who maintains them, and how?
9. **Who are the current alert recipients,** and should they all receive enquiry alerts too?
10. **The "Expired" invitation label** never appears. Should expired invites be shown as such?
11. **Desired wording** for the manual's escalation path (who to contact for configuration failures on the Email Delivery panel).
