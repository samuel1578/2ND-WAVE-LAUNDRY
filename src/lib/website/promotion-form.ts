export const promotionLinkOptions = [
  ["", "No button"],
  ["/", "Homepage"],
  ["/book", "Book a pickup"],
  ["/services", "Our services"],
  ["/how-it-works", "How it works"],
  ["/locations", "Find a branch"],
  ["/gallery", "Gallery"],
  ["/blog", "Laundry notes"],
  ["/about", "About 2nd Wave"],
  ["/commercial-laundry", "Commercial laundry"],
  ["/contact", "Contact the team"],
  ["/faq", "Frequently asked questions"],
  ["/reviews", "Customer reviews"],
  ["custom", "Another website (paste a link)"],
] as const;

export function promotionLinkSelection(href: string): string {
  return promotionLinkOptions.some(([value]) => value === href) ? href : href ? "custom" : "";
}
