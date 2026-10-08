"use client";
import { useRef, useState } from "react";
import { useMotionValueEvent, useScroll } from "motion/react";
import { ProgressIndicator, StageOne, StageTwo, StageThree } from "./stages";
import { stageFromProgress } from "./ranges";
import { StaticHero } from "./static-hero";
import { useHeroMode } from "./use-hero-mode";

function AnimatedHero() {
  const wrapperRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: wrapperRef,
    offset: ["start start", "end end"],
  });
  const stageRef = useRef(0);
  const [stage, setStage] = useState(0);

  useMotionValueEvent(scrollYProgress, "change", (value) => {
    const next = stageFromProgress(value);
    if (next !== stageRef.current) {
      stageRef.current = next;
      setStage(next);
    }
  });

  return (
    <section className="scrolly-hero" ref={wrapperRef}>
      <div className="scrolly-hero__sticky">
        <div className="scrolly-hero__frame container">
          <ProgressIndicator progress={scrollYProgress} stage={stage} />
          <StageOne progress={scrollYProgress} active={stage === 0} />
          <StageTwo progress={scrollYProgress} active={stage === 1} />
          <StageThree progress={scrollYProgress} active={stage === 2} />
        </div>
      </div>
    </section>
  );
}

export function HomeHero() {
  const mode = useHeroMode();
  return mode === "static" ? <StaticHero /> : <AnimatedHero />;
}
