"use client";
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
import { m, useSpring, useTransform, type MotionValue } from "motion/react";
import type { ReactNode } from "react";
import { BrandText } from "@/components/brand-text";
import { Action } from "@/components/ui";
import { heroContent, stageImages, stageOneTitle } from "./content";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const SHOT_SIZES = "(max-width: 900px) calc(100vw - 40px), 44vw";

type StageProps = { progress: MotionValue<number>; active: boolean };

const factIcons = { check: Check, pin: MapPin, clock: Clock };

function Rise({
  delay = 0,
  y = 18,
  className,
  children,
}: {
  delay?: number;
  y?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <m.div
      className={className}
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay, ease: EASE }}
    >
      {children}
    </m.div>
  );
}

function Cue({
  progress,
  label,
  input,
  output,
  entrance = false,
}: {
  progress: MotionValue<number>;
  label: string;
  input: number[];
  output: number[];
  entrance?: boolean;
}) {
  const opacity = useTransform(progress, input, output);
  return (
    <m.a className="hero-cue" href="#services" style={{ opacity }}>
      <Rise delay={entrance ? 0.72 : 0} y={10}>
        <ArrowDown size={16} aria-hidden="true" />
        <span>{label}</span>
      </Rise>
    </m.a>
  );
}

function StageOne({ progress, active }: StageProps) {
  const envelope = useTransform(progress, [0.22, 0.4], [1, 0]);
  const pillOpacity = useTransform(progress, [0.14, 0.26], [1, 0]);
  const pillY = useTransform(progress, [0, 0.28], [0, -20]);
  const brandOpacity = useTransform(progress, [0.16, 0.3], [1, 0]);
  const brandY = useTransform(progress, [0, 0.3], [0, -34]);
  const titleOpacity = useTransform(progress, [0.24, 0.4], [1, 0]);
  const titleY = useTransform(progress, [0, 0.34], [0, -74]);
  const leadOpacity = useTransform(progress, [0.2, 0.36], [1, 0]);
  const leadY = useTransform(progress, [0, 0.34], [0, -40]);
  const actionsOpacity = useTransform(progress, [0.18, 0.32], [1, 0]);
  const actionsY = useTransform(progress, [0, 0.3], [0, 30]);
  const chatOpacity = useTransform(progress, [0.16, 0.3], [1, 0]);
  const mediaOpacity = useTransform(progress, [0.26, 0.4], [1, 0]);
  const mediaX = useTransform(progress, [0, 0.4], [0, -40]);
  const mediaY = useTransform(progress, [0, 0.4], [0, -16]);
  const shotScale = useTransform(progress, [0, 0.4], [1, 1.07]);

  return (
    <m.div
      className="hero-stage hero-stage--one"
      style={{ opacity: envelope }}
      aria-hidden={!active}
      inert={!active}
    >
      <div className="hero-stage__copy">
        <m.div className="hero-pill" style={{ opacity: pillOpacity, y: pillY }}>
          <Rise delay={0.05}>
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
          </Rise>
        </m.div>
        <m.div
          className="hero-brandline"
          style={{ opacity: brandOpacity, y: brandY }}
        >
          <Rise delay={0.1} y={14}>
            <p className="eyebrow">
              <BrandText text={heroContent.brandLine} />
            </p>
          </Rise>
        </m.div>
        <m.div style={{ opacity: titleOpacity, y: titleY }}>
          <Rise delay={0.18} y={22}>
            <h1>
              {stageOneTitle[0]}
              {stageOneTitle[1] && (
                <>
                  <br />
                  <span>{stageOneTitle[1]}</span>
                </>
              )}
            </h1>
          </Rise>
        </m.div>
        <m.div style={{ opacity: leadOpacity, y: leadY }}>
          <Rise delay={0.26} y={18}>
            <p className="lead hero-lead">{heroContent.lead}</p>
          </Rise>
        </m.div>
        <m.div style={{ opacity: actionsOpacity, y: actionsY }}>
          <Rise delay={0.34} y={16}>
            <div className="actions">
              <Action href="/book">Book a Pickup</Action>
              <Action href="/locations" secondary>
                Visit a Branch
              </Action>
            </div>
          </Rise>
        </m.div>
        <m.div className="hero-wa" style={{ opacity: chatOpacity, y: actionsY }}>
          <Rise delay={0.42} y={14}>
            <a className="text-link" href={heroContent.whatsapp}>
              {heroContent.whatsappLabel}
            </a>
          </Rise>
        </m.div>
      </div>
      <m.div
        className="hero-stage__media"
        style={{ opacity: mediaOpacity, x: mediaX, y: mediaY }}
      >
        <div className="hero-shot hero-shot--one">
          <m.div className="hero-shot__frame" style={{ scale: shotScale }}>
            <m.div
              className="hero-shot__clip"
              initial={{ clipPath: "inset(0% 0% 100% 0%)" }}
              animate={{ clipPath: "inset(0% 0% 0% 0%)" }}
              transition={{ duration: 0.75, delay: 0.32, ease: EASE }}
            >
              <Image
                src={stageImages.opening.src}
                alt={stageImages.opening.alt}
                width={1536}
                height={1024}
                sizes={SHOT_SIZES}
                priority
              />
            </m.div>
          </m.div>
          <Rise delay={0.6} y={16}>
            <div className="hero-caption">
              <span className="eyebrow">{heroContent.captionKicker}</span>
              <p>{heroContent.captionBody}</p>
              <Link
                href="/how-it-works"
                aria-label={heroContent.captionLinkLabel}
              >
                <ArrowUpRight aria-hidden="true" />
              </Link>
            </div>
          </Rise>
        </div>
      </m.div>
      <Cue
        progress={progress}
        label={heroContent.cues.one}
        input={[0.08, 0.2]}
        output={[1, 0]}
        entrance
      />
    </m.div>
  );
}

function CareChip({
  progress,
  index,
  label,
  href,
}: {
  progress: MotionValue<number>;
  index: number;
  label: string;
  href: string;
}) {
  const enter = 0.26 + index * 0.03;
  const opacity = useTransform(
    progress,
    [enter, enter + 0.12, 0.54 + index * 0.02, 0.62 + index * 0.02],
    [0, 1, 1, 0],
  );
  const y = useTransform(progress, [enter, enter + 0.12], [14, 0]);
  return (
    <m.li className="hero-chip" style={{ opacity, y }}>
      <Link className="hero-chip__face" href={href}>
        {label}
      </Link>
    </m.li>
  );
}

function CareCard({
  progress,
  index,
  title,
  body,
  href,
}: {
  progress: MotionValue<number>;
  index: number;
  title: string;
  body: string;
  href: string;
}) {
  const enter = 0.34 + index * 0.05;
  const opacity = useTransform(
    progress,
    [enter, enter + 0.1, 0.58 + index * 0.03, 0.66 + index * 0.03],
    [0, 1, 1, 0],
  );
  const y = useTransform(progress, [enter, enter + 0.1], [26, 0]);
  const Icon = index === 0 ? Droplets : Footprints;
  return (
    <m.li className="hero-card" style={{ opacity, y }}>
      <Link className="hero-card__face" href={href}>
        <span className="hero-card__icon" aria-hidden="true">
          <Icon size={18} />
        </span>
        <div className="hero-card__text">
          <h3>{title}</h3>
          <p>{body}</p>
        </div>
      </Link>
    </m.li>
  );
}

function StageTwo({ progress, active }: StageProps) {
  const envelope = useTransform(
    progress,
    [0.22, 0.4, 0.58, 0.76],
    [0, 1, 1, 0],
  );
  const mediaY = useTransform(
    progress,
    [0.22, 0.4, 0.58, 0.76],
    [52, 0, 0, -34],
  );
  const mediaX = useTransform(progress, [0.58, 0.76], [0, -44]);
  const mediaScale = useTransform(progress, [0.22, 0.4], [1.07, 1]);
  const parallaxIn = useTransform(progress, [0.3, 0.68], [-8, 8]);
  const parallax = useSpring(parallaxIn, {
    stiffness: 130,
    damping: 22,
    mass: 0.35,
  });
  const textY = useTransform(
    progress,
    [0.22, 0.4, 0.58, 0.76],
    [56, 0, 0, -66],
  );
  const headingOpacity = useTransform(progress, [0.24, 0.36], [0, 1]);
  const bodyOpacity = useTransform(progress, [0.28, 0.4], [0, 1]);
  const waveX = useTransform(progress, [0.22, 0.58, 0.76], [-28, 0, 46]);
  const waveY = useTransform(progress, [0.22, 0.58, 0.76], [14, 0, -18]);
  const waveRotate = useTransform(progress, [0.22, 0.76], [-4, 3]);
  const waveOpacity = useTransform(
    progress,
    [0.24, 0.36, 0.5, 0.6],
    [0, 0.9, 0.9, 0],
  );

  return (
    <m.div
      className="hero-stage hero-stage--two"
      style={{ opacity: envelope }}
      aria-hidden={!active}
      inert={!active}
    >
      <m.div
        className="hero-stage__media"
        style={{ y: mediaY, x: mediaX }}
      >
        <m.div
          className="hero-shot hero-shot--two"
          style={{ y: parallax }}
        >
          <m.div className="hero-shot__frame" style={{ scale: mediaScale }}>
            <Image
              src={stageImages.care.src}
              alt={stageImages.care.alt}
              width={1536}
              height={1024}
              sizes={SHOT_SIZES}
            />
          </m.div>
          <m.svg
            className="hero-wave"
            viewBox="0 0 360 120"
            fill="none"
            aria-hidden="true"
            style={{ x: waveX, y: waveY, rotate: waveRotate, opacity: waveOpacity }}
          >
            <path
              d="M0 60 C 45 8, 90 112, 135 60 S 225 8, 270 60 S 360 112, 360 60"
              stroke="var(--primary)"
              strokeWidth="3"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </m.svg>
        </m.div>
      </m.div>
      <m.div className="hero-stage__copy" style={{ y: textY }}>
        <m.h2 style={{ opacity: headingOpacity }}>
          {heroContent.care.heading}
        </m.h2>
        <m.p
          className="lead hero-lead"
          style={{ opacity: bodyOpacity }}
        >
          {heroContent.care.body}
        </m.p>
        <ul className="hero-chips">
          {heroContent.care.chips.map((chip, index) => (
            <CareChip
              key={chip.label}
              progress={progress}
              index={index}
              label={chip.label}
              href={chip.href}
            />
          ))}
        </ul>
        <ul className="hero-cards">
          {heroContent.care.cards.map((card, index) => (
            <CareCard
              key={card.title}
              progress={progress}
              index={index}
              title={card.title}
              body={card.body}
              href={card.href}
            />
          ))}
        </ul>
      </m.div>
      <Cue
        progress={progress}
        label={heroContent.cues.two}
        input={[0.32, 0.4, 0.52, 0.58]}
        output={[0, 1, 1, 0]}
      />
    </m.div>
  );
}

function StageThree({ progress, active }: StageProps) {
  const envelope = useTransform(progress, [0.58, 0.76], [0, 1]);
  const clipPath = useTransform(
    progress,
    [0.58, 0.72],
    ["inset(0% 0% 100% 0%)", "inset(0% 0% 0% 0%)"],
  );
  const mediaY = useTransform(progress, [0.58, 0.74], [44, 0]);
  const textY = useTransform(progress, [0.6, 0.76], [52, 0]);
  const eyebrowOpacity = useTransform(progress, [0.6, 0.67], [0, 1]);
  const headingOpacity = useTransform(progress, [0.62, 0.7], [0, 1]);
  const bodyOpacity = useTransform(progress, [0.64, 0.72], [0, 1]);
  const actionsOpacity = useTransform(progress, [0.66, 0.74], [0, 1]);
  const helperOpacity = useTransform(progress, [0.7, 0.78], [0, 1]);

  return (
    <m.div
      className="hero-stage hero-stage--three"
      style={{ opacity: envelope }}
      aria-hidden={!active}
      inert={!active}
    >
      <m.div className="hero-stage__copy" style={{ y: textY }}>
        <m.p className="eyebrow" style={{ opacity: eyebrowOpacity }}>
          {heroContent.final.eyebrow}
        </m.p>
        <m.h2 style={{ opacity: headingOpacity }}>
          {heroContent.final.heading}
        </m.h2>
        <m.p className="lead hero-lead" style={{ opacity: bodyOpacity }}>
          {heroContent.final.body}
        </m.p>
        <m.div className="actions" style={{ opacity: actionsOpacity }}>
          <Action href="/book">Book a Pickup</Action>
          <Action href="/locations" secondary>
            Visit a Branch
          </Action>
          <a className="button whatsapp" href={heroContent.whatsapp}>
            {heroContent.whatsappLabel}
          </a>
        </m.div>
        <m.div className="hero-helper" style={{ opacity: helperOpacity }}>
          <p>
            <Package size={16} aria-hidden="true" />
            <span>{heroContent.final.pickup}</span>
          </p>
          <p>
            <Store size={16} aria-hidden="true" />
            <span>{heroContent.final.dropoff}</span>
          </p>
        </m.div>
      </m.div>
      <m.div className="hero-stage__media" style={{ y: mediaY }}>
        <div className="hero-shot hero-shot--three">
          <m.div className="hero-shot__clip" style={{ clipPath }}>
            <Image
              src={stageImages.collection.src}
              alt={stageImages.collection.alt}
              width={1536}
              height={1024}
              sizes={SHOT_SIZES}
            />
          </m.div>
        </div>
      </m.div>
      <Cue
        progress={progress}
        label={heroContent.cues.three}
        input={[0.74, 0.82]}
        output={[0, 1]}
      />
    </m.div>
  );
}

function ProgressIndicator({
  progress,
  stage,
}: {
  progress: MotionValue<number>;
  stage: number;
}) {
  const opacity = useTransform(progress, [0.22, 0.34], [0, 1]);
  const fillTwo = useTransform(progress, [0.22, 0.4], [0, 1]);
  const fillThree = useTransform(progress, [0.58, 0.76], [0, 1]);
  const stateOpacity = [
    useTransform(progress, [0.24, 0.34], [1, 0]),
    useTransform(progress, [0.24, 0.34, 0.6, 0.7], [0, 1, 1, 0]),
    useTransform(progress, [0.6, 0.7], [0, 1]),
  ];

  return (
    <m.div
      className="hero-progress"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={3}
      aria-valuenow={stage + 1}
      aria-label="Introduction chapters"
      aria-hidden={stage === 0}
      style={{ opacity }}
    >
      <span className="hero-progress__chapter">
        <b>Chapter</b>
        <span className="hero-progress__num">
          {["01", "02", "03"].map((num, i) => (
            <m.span
              key={num}
              className="hero-progress__num-item"
              style={{ opacity: stateOpacity[i] }}
            >
              {num}
            </m.span>
          ))}
        </span>
        <span className="hero-progress__of">/ 03</span>
      </span>
      <span className="hero-progress__track" aria-hidden="true">
        <span className="hero-progress__seg">
          <i className="is-full" />
        </span>
        <span className="hero-progress__seg">
          <m.i style={{ scaleX: fillTwo }} />
        </span>
        <span className="hero-progress__seg">
          <m.i style={{ scaleX: fillThree }} />
        </span>
      </span>
      <span className="hero-progress__names">
        {heroContent.chapters.map((name, i) => (
          <m.span
            key={name}
            className="hero-progress__name"
            style={{ opacity: stateOpacity[i] }}
          >
            {name}
          </m.span>
        ))}
      </span>
    </m.div>
  );
}

export { ProgressIndicator, StageOne, StageTwo, StageThree };
