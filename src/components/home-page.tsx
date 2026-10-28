import Link from "next/link";
import { copy, services, foldedLinen, photos, faqs } from "@/lib/content";
import {
  Action,
  BranchCards,
  Closing,
  FAQ,
  Picture,
  PickupChoice,
  Section,
  ServiceCard,
} from "./ui";
import { Reveal } from "./motion";
import { SwipeTrack } from "./swipe-track";
import { CascadeSlider } from "./cascade-slider";
import { Promotion, Newsletter } from "./published-content";
import { HomeHero } from "./home-hero";
import { readNewsletterInterestConfig } from "@/lib/newsletter/config";

const galleryTiles = photos.batch_14_gallery ?? [];

export function HomePage() {
  const newsletterInterestEnabled = readNewsletterInterestConfig().enabled;
  return (
    <>
      <HomeHero />
      <div className="container">
        <Section
          id="services"
          title={copy("02", "Services heading")}
          description={copy("02", "Services intro")}
        >
          <SwipeTrack className="grid three">
            {[
              services[0],
              services[1],
              services[3],
              services[4],
              services[9],
            ].map((service, i) => (
              <ServiceCard key={service.slug} service={service} index={i} />
            ))}
          </SwipeTrack>
          <div className="section-link">
            <Action href="/services" secondary>
              View All Services
            </Action>
          </div>
        </Section>
        <Section title="Pickup or drop-off">
          <PickupChoice />
        </Section>
        <Section title={copy("02", "Process heading")}>
          <div className="process-grid">
            {[1, 2, 3].map((n) => {
              const [title, ...rest] = copy("02", `Step ${n}`).split(" — ");
              return (
                <Reveal key={n} delay={n * 0.04}>
                  <article>
                    <span className="process-number">0{n}</span>
                    <h3>{title}</h3>
                    <p>{rest.join(" — ")}</p>
                  </article>
                </Reveal>
              );
            })}
          </div>
          <Action href="/how-it-works" secondary>
            See How It Works
          </Action>
        </Section>
        <Promotion />
        <Section title="Find your nearest branch">
          <BranchCards />
        </Section>
        <Section title="A closer look">
          <CascadeSlider label="Gallery highlights">
            {galleryTiles.map((photo, i) => (
              <Reveal key={photo.src} delay={i * 0.06}>
                <Link href="/gallery" className="tile">
                  <Picture photo={photo} />
                  <div className="tile-caption">
                    <span className="eyebrow">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <p>{photo.alt}</p>
                  </div>
                </Link>
              </Reveal>
            ))}
          </CascadeSlider>
          <div className="section-link">
            <Action href="/gallery" secondary>
              View Gallery
            </Action>
          </div>
        </Section>
        <Section className="editorial-split">
          <Picture photo={foldedLinen} />
          <Reveal>
            <p className="eyebrow">Commercial Laundry</p>
            <h2>{copy("10.01", "Information heading")}</h2>
            <p>{copy("10.01", "Information")}</p>
            <Action href="/commercial-laundry">Request a Quote</Action>
          </Reveal>
        </Section>
        <Section title="Questions before you book?">
          <FAQ items={faqs.slice(0, 5)} />
          <div className="section-link">
            <Link href="/faq" className="text-link">
              View All FAQs ↗
            </Link>
          </div>
        </Section>
        <Closing />
        <Newsletter interestEnabled={newsletterInterestEnabled} />
      </div>
    </>
  );
}
