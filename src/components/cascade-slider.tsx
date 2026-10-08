"use client";
import { Children, useRef, useState, type ReactNode } from "react";
import type { Swiper as SwiperClass } from "swiper";
import { A11y, Keyboard, Pagination } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import "swiper/css";
import "swiper/css/pagination";

export function CascadeSlider({
  children,
  label = "Image carousel",
}: {
  children: ReactNode;
  label?: string;
}) {
  const swiperRef = useRef<SwiperClass | null>(null);
  const [realIndex, setRealIndex] = useState(0);
  const slides = Children.toArray(children);
  const count = slides.length;
  const loop = count > 2;
  const atStart = count < 2 || (!loop && realIndex === 0);
  const atEnd = count < 2 || (!loop && realIndex === count - 1);
  const go = (dir: -1 | 1) => {
    if (dir === -1) swiperRef.current?.slidePrev();
    else swiperRef.current?.slideNext();
  };

  return (
    <div className="cascade" role="group" aria-label={label}>
      <button
        type="button"
        className="cascade__arrow"
        aria-label="Previous slide"
        disabled={atStart}
        onClick={() => go(-1)}
      >
        <ChevronLeft size={20} aria-hidden="true" />
      </button>
      <div className="cascade__panel">
        <Swiper
          className="gallery-cascade"
          modules={[Pagination, A11y, Keyboard]}
          spaceBetween={14}
          slidesPerView={1.15}
          loop={loop}
          pagination={count > 1 ? { clickable: true } : false}
          onSwiper={(s) => {
            swiperRef.current = s;
            setRealIndex(s.realIndex);
          }}
          onSlideChange={(s) => setRealIndex(s.realIndex)}
          breakpoints={{
            701: {
              slidesPerView: "auto",
              spaceBetween: 18,
              centeredSlides: loop,
              grabCursor: true,
            },
          }}
        >
          {slides.map((slide, i) => (
            <SwiperSlide key={i}>{slide}</SwiperSlide>
          ))}
        </Swiper>
        <div className="cascade__nav">
          <button
            type="button"
            aria-label="Previous slide"
            disabled={atStart}
            onClick={() => go(-1)}
          >
            <ArrowLeft size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Next slide"
            disabled={atEnd}
            onClick={() => go(1)}
          >
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      <button
        type="button"
        className="cascade__arrow"
        aria-label="Next slide"
        disabled={atEnd}
        onClick={() => go(1)}
      >
        <ChevronRight size={20} aria-hidden="true" />
      </button>
    </div>
  );
}
