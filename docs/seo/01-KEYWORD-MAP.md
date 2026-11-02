# Keyword map — 2nd Wave Laundry Services

Rules used:
- One primary keyword per page; no two pages share a primary.
- Secondary keywords are supporting phrases, not separate targets.
- Nothing here claims a service, area, price or credential the site does not publish.
- Brand terms use the numeral form ("2nd Wave") because that is the trading name; "Second Wave
  Laundry" appears once on the About page to capture spelled-out searches.

| Page | Primary keyword | Secondary keywords | Intent | Notes |
| --- | --- | --- | --- | --- |
| `/` | 2nd Wave Laundry | laundry services Ashaiman; laundry in Katamanso; laundry pickup and delivery Ghana | Brand / local | Home title begins with the brand and names both branch areas. |
| `/services` | laundry services in Ashaiman | laundry and garment care Ghana; laundry service list | Local / commercial | Hub for all service pages. |
| `/services/wash-ironing-fold` | wash, ironing and fold laundry | everyday laundry service; wash iron fold near me | Service | Exclusions (bedding, suits, Kente, rugs, sneakers) are already published and stay. |
| `/services/wash-and-fold-only` | wash and fold only | laundry without ironing; folded laundry service | Service | Distinct from the ironing-inclusive service. |
| `/services/ironing` | laundry ironing service | garment pressing; shirt ironing Ghana | Service | |
| `/services/stain-treatment` | stain treatment laundry service | stain removal; stubborn stain cleaning | Service | Result is explicitly not guaranteed on the page. |
| `/services/duvet-and-bedding-cleaning` | duvet and bedding cleaning | duvet wash Ghana; bedding laundry | Service | |
| `/services/curtain-cleaning` | curtain cleaning | deep clean curtains; curtain laundry service | Service | |
| `/services/suit-cleaning` | suit cleaning | suit laundry; jacket cleaning | Service | |
| `/services/shoe-care` | shoe care and cleaning | sneaker cleaning; shoe laundry service | Service | |
| `/services/express-same-day-laundry` | same-day laundry service | express laundry; 11am cutoff laundry | Service | Same-day is not guaranteed; the page says so. |
| `/services/pickup-and-delivery` | laundry pickup and delivery | laundry collection service; book laundry pickup | Service | |
| `/commercial-laundry` | commercial laundry services Ghana | business laundry service; commercial laundry quote | Commercial | Do not use "hotels and restaurants" until the owner confirms those segments. |
| `/locations` | laundry branches in Ashaiman and Katamanso | laundry near me; laundry drop-off near me | Local hub | Hub, not a competitor to the branch pages. |
| `/locations/ashaiman-atadeka` | laundry in Ashaiman | laundry in Atadeka; main laundry branch Ashaiman | Local | Main branch, Mon–Sat 7am–8pm, Sun 9am–7:30pm. |
| `/locations/katamanso-no-1` | laundry in Katamanso | Katamanso laundry drop-off; laundry near Katamanso No. 1 | Local | Branch phone 059 814 8620. |
| `/locations/newland-katamanso` | laundry in Newland Katamanso | Newland laundry service; laundry drop-off Katamanso | Local | Branch phone 024 614 4412. |
| `/about` | 2nd Wave Laundry Services | Second Wave Laundry; about 2nd Wave Laundry | Brand | The only place "Second Wave Laundry" is used, once. |
| `/contact` | contact 2nd Wave Laundry | laundry phone number Ghana; laundry WhatsApp | Brand / transactional | Phone in +233 format for click-to-call. |
| `/how-it-works` | how laundry pickup works | laundry request process; laundry drop-off steps | Informational | Steps are the published process, not a promise of timing. |
| `/faq` | laundry questions answered | laundry pickup FAQ; laundry booking FAQ | Informational | Answers mirror the visible accordion and FAQPage JSON-LD. |
| `/gallery` | laundry photos Ghana | 2nd Wave laundry gallery; folded laundry photos | Navigational | Low priority; images are not a ranking target. |
| `/blog` | laundry care advice | laundry tips Ghana; garment care notes | Informational | Index only; individual posts get their own primaries. |
| `/privacy`, `/terms`, `/laundry-care-terms` | — | — | Legal | No keyword assignment; indexable but not optimised. |
| `/book` | — | — | Transactional | `noindex`; reachable from every page. |
| `/reviews`, `/reviews/share` | — | — | Transactional | `noindex` because the initial HTML is an empty state. |

## Local keyword coverage

| Area | Staffed branch | Target page | Primary |
| --- | --- | --- | --- |
| Ashaiman | Yes (Ashaiman–Atadeka) | `/locations/ashaiman-atadeka` | laundry in Ashaiman |
| Atadeka | Served by the Ashaiman branch | `/locations/ashaiman-atadeka` | laundry in Atadeka (secondary) |
| Katamanso | Yes (Katamanso No. 1) | `/locations/katamanso-no-1` | laundry in Katamanso |
| Newland Katamanso | Yes (Newland Katamanso) | `/locations/newland-katamanso` | laundry in Newland Katamanso |

No pickup-only service areas are published, so no `/areas/*` pages exist and no area keyword is
assigned. See the TODO list in the final report.

## Cannibalisation checks

- Home targets the brand plus both branch areas; branch pages target the area-specific phrase. Home
  links to the branch pages rather than repeating their copy.
- Each service page owns exactly one service phrase; related-service links use the other pages'
  titles, not their primary keywords.
- `/locations` targets the hub phrase ("branches"), not "laundry in Ashaiman".
- Blog posts in the content plan avoid the primary keywords of the service and branch pages.
