import { contact, copy, serviceHref, type Photo } from "@/lib/content";

export const stageImages = {
  opening: {
    src: "/images/hero1.jpg",
    alt: "Rolled towels and folded linens on a table at the 2nd Wave facility",
  },
  care: {
    src: "/images/hero2.png",
    alt: "A 2nd Wave team member in uniform beside neatly folded laundry",
  },
  collection: {
    src: "/images/hero3.png",
    alt: "Freshly cleaned garments in protective covers on a rolling rack",
  },
} satisfies Record<string, Photo>;

const fullTitle = copy("02", "H1");
const titleCut = fullTitle.indexOf("Laundry");

export const stageOneTitle =
  titleCut > 0
    ? [fullTitle.slice(0, titleCut).trim(), fullTitle.slice(titleCut).trim()]
    : [fullTitle, ""];

const captionLine = copy("02", "Final-state line").split(". ");

export const heroContent = {
  brandLine: "2nd Wave Laundry Services",
  lead: copy("02", "Intro"),
  whatsapp: contact.whatsapp,
  whatsappLabel: "Chat on WhatsApp",
  facts: [
    { icon: "check" as const, text: "Walk-ins and drop-offs welcome" },
    { icon: "pin" as const, text: "Three branches" },
    { icon: "clock" as const, text: "Pickup 7am–5pm" },
  ],
  captionKicker: captionLine[0] || "Pickup or drop-off.",
  captionBody: captionLine[1] || "Choose what suits you.",
  captionLinkLabel: "See How It Works",
  cues: {
    one: "Scroll to explore",
    two: "Continue scrolling",
    three: "Scroll to explore services",
  },
  chapters: ["Opening", "Care in Motion", "Collection & Drop-off"],
  chapterLabels: ["Chapter 01 / 03", "Chapter 02 / 03", "Chapter 03 / 03"],
  care: {
    heading: copy("02", "Middle-state line"),
    body: copy("04.01", "Intro"),
    chips: [
      { label: copy("04.01", "H1"), href: serviceHref("wash-ironing-fold") },
      { label: copy("04.03", "H1"), href: serviceHref("ironing") },
      { label: copy("04.08", "H1"), href: serviceHref("shoe-care") },
      { label: copy("04.04", "H1"), href: serviceHref("stain-treatment") },
    ],
    cards: [
      {
        title: copy("04.04", "H1"),
        body: copy("04.04", "Intro"),
        href: serviceHref("stain-treatment"),
      },
      {
        title: copy("04.08", "H1"),
        body: copy("04.08", "Intro"),
        href: serviceHref("shoe-care"),
      },
    ],
  },
  final: {
    eyebrow: "03 / Collection and drop-off",
    heading: copy("05", "H1"),
    body: copy("05", "Intro"),
    pickup: copy("02", "Pickup text"),
    dropoff: copy("02", "Drop-off text"),
  },
};
