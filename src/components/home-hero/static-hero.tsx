import Image from "next/image";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  Clock,
  Droplets,
  Footprints,
  MapPin,
  Package,
  Store,
} from "lucide-react";
import { BrandText } from "@/components/brand-text";
import { Action } from "@/components/ui";
import { heroContent, stageImages, stageOneTitle } from "./content";

const SHOT_SIZES = "(max-width: 900px) calc(100vw - 40px), 44vw";
const factIcons = { check: Check, pin: MapPin, clock: Clock };

function StaticCue({ label }: { label: string }) {
  return (
    <a className="hero-cue" href="#services">
      <ArrowDown size={16} aria-hidden="true" />
      <span>{label}</span>
    </a>
  );
}

export function StaticHero() {
  return (
    <section className="hero-static container">
      <div className="hero-static__stage hero-stage hero-stage--one">
        <div className="hero-stage__copy">
          <div className="hero-pill">
            <span className="hero-pill__inner">
              {heroContent.facts.map((fact) => {
                const Icon = factIcons[fact.icon];
                return (
                  <span className="hero-pill__item" key={fact.text}>
                    <Icon size={14} aria-hidden="true" />
                    <span className="brand-glow">{fact.text}</span>
                  </span>
                );
              })}
            </span>
          </div>
          <div className="hero-brandline">
            <p className="eyebrow">
              <BrandText text={heroContent.brandLine} />
            </p>
          </div>
          <h1>
            {stageOneTitle[0]}
            {stageOneTitle[1] && (
              <>
                <br />
                <span>{stageOneTitle[1]}</span>
              </>
            )}
          </h1>
          <p className="lead hero-lead">{heroContent.lead}</p>
          <div className="actions">
            <Action href="/book">Book a Pickup</Action>
            <Action href="/locations" secondary>
              Visit a Branch
            </Action>
          </div>
          <div className="hero-wa">
            <a className="text-link" href={heroContent.whatsapp}>
              {heroContent.whatsappLabel}
            </a>
          </div>
        </div>
        <div className="hero-stage__media">
          <div className="hero-shot hero-shot--one">
            <div className="hero-shot__frame">
              <div className="hero-shot__clip">
                <Image
                  src={stageImages.opening.src}
                  alt={stageImages.opening.alt}
                  width={1536}
                  height={1024}
                  sizes={SHOT_SIZES}
                  priority
                />
              </div>
            </div>
            <div className="hero-caption">
              <span className="eyebrow">{heroContent.captionKicker}</span>
              <p>{heroContent.captionBody}</p>
              <Link href="/how-it-works" aria-label={heroContent.captionLinkLabel}>
                <ArrowUpRight aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
        <StaticCue label={heroContent.cues.one} />
      </div>

      <div className="hero-static__stage hero-stage hero-stage--two">
        <div className="hero-stage__copy">
          <p className="eyebrow">
            {heroContent.chapterLabels[1]} · {heroContent.chapters[1]}
          </p>
          <h2>{heroContent.care.heading}</h2>
          <p className="lead hero-lead">{heroContent.care.body}</p>
          <ul className="hero-chips">
            {heroContent.care.chips.map((chip) => (
              <li className="hero-chip" key={chip.label}>
                <Link className="hero-chip__face" href={chip.href}>
                  {chip.label}
                </Link>
              </li>
            ))}
          </ul>
          <ul className="hero-cards">
            {heroContent.care.cards.map((card, index) => {
              const Icon = index === 0 ? Droplets : Footprints;
              return (
                <li className="hero-card" key={card.title}>
                  <Link className="hero-card__face" href={card.href}>
                    <span className="hero-card__icon" aria-hidden="true">
                      <Icon size={18} />
                    </span>
                    <div className="hero-card__text">
                      <h3>{card.title}</h3>
                      <p>{card.body}</p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="hero-stage__media">
          <div className="hero-shot hero-shot--two">
            <div className="hero-shot__frame">
              <div className="hero-shot__clip">
                <Image
                  src={stageImages.care.src}
                  alt={stageImages.care.alt}
                  width={1536}
                  height={1024}
                  sizes={SHOT_SIZES}
                />
              </div>
            </div>
            <svg
              className="hero-wave"
              viewBox="0 0 360 120"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M0 60 C 45 8, 90 112, 135 60 S 225 8, 270 60 S 360 112, 360 60"
                stroke="var(--primary)"
                strokeWidth="3"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>
        </div>
        <StaticCue label={heroContent.cues.two} />
      </div>

      <div className="hero-static__stage hero-stage hero-stage--three">
        <div className="hero-stage__copy">
          <p className="eyebrow">{heroContent.final.eyebrow}</p>
          <h2>{heroContent.final.heading}</h2>
          <p className="lead hero-lead">{heroContent.final.body}</p>
          <div className="actions">
            <Action href="/book">Book a Pickup</Action>
            <Action href="/locations" secondary>
              Visit a Branch
            </Action>
            <a className="button whatsapp" href={heroContent.whatsapp}>
              {heroContent.whatsappLabel}
            </a>
          </div>
          <div className="hero-helper">
            <p>
              <Package size={16} aria-hidden="true" />
              <span>{heroContent.final.pickup}</span>
            </p>
            <p>
              <Store size={16} aria-hidden="true" />
              <span>{heroContent.final.dropoff}</span>
            </p>
          </div>
        </div>
        <div className="hero-stage__media">
          <div className="hero-shot hero-shot--three">
            <div className="hero-shot__frame">
              <div className="hero-shot__clip">
                <Image
                  src={stageImages.collection.src}
                  alt={stageImages.collection.alt}
                  width={1536}
                  height={1024}
                  sizes={SHOT_SIZES}
                />
              </div>
            </div>
          </div>
        </div>
        <StaticCue label={heroContent.cues.three} />
      </div>
    </section>
  );
}
