"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import {
  Menu,
  ArrowUpRight,
  Monitor,
  Sun,
  Moon,
  Shirt,
  WashingMachine,
  LayoutDashboard,
  CalendarDays,
  MessageSquare,
  Star,
  Mail,
  Files,
  Images,
  Settings,
  LogOut,
} from "lucide-react";
import { adminNav, publicNav, contact, demoMode } from "@/lib/content";
import { BrandText } from "./brand-text";
import { Dialog } from "./dialog";
const adminIcons = [
  LayoutDashboard,
  CalendarDays,
  MessageSquare,
  Star,
  Mail,
  Files,
  Images,
  Settings,
];
const headerNavLabels = [
  "Services",
  "How It Works",
  "Locations",
  "About",
  "Blog",
  "Contact",
];
const headerNav = headerNavLabels
  .map((name) => publicNav.find(([label]) => label === name))
  .filter((entry): entry is string[] => entry !== undefined);
export function Logo({
  large = false,
  label,
}: {
  large?: boolean;
  label?: boolean;
}) {
  const showLabel = label ?? !large;
  return (
    <Link
      href="/"
      aria-label="2nd Wave Laundry Services — Home"
      className={`logo ${large ? "large" : ""}`}
    >
      <Image
        src="/images/logo.png"
        alt="2nd Wave Laundry Services"
        width={large ? 220 : 68}
        height={large ? 220 : 68}
        priority
      />
      {showLabel && <span>2nd Wave Laundry</span>}
    </Link>
  );
}
export function ThemeControl() {
  const { theme, setTheme } = useTheme();
  return (
    <fieldset className="theme-control">
      <legend>Appearance</legend>
      {[
        ["system", "System", Monitor],
        ["light", "Light", Sun],
        ["dark", "Dark", Moon],
      ].map(([value, label, Icon]) => {
        const Symbol = Icon as typeof Sun;
        return (
          <label key={value as string}>
            <input
              type="radio"
              name="theme"
              value={value as string}
              checked={theme === value}
              onChange={() => setTheme(value as string)}
            />
            <Symbol size={17} />
            <span>{label as string}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
export function Header() {
  const path = usePathname();
  const admin = path.startsWith("/admin");
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [indicator, setIndicator] = useState({
    left: 0,
    width: 0,
    visible: false,
  });
  const navRef = useRef<HTMLElement | null>(null);
  const linkRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const links = admin ? adminNav : publicNav;
  const isActive = (href: string) =>
    href === "/" ? path === href : path.startsWith(href);
  const activeHref = !admin
    ? (headerNav.find(([, href]) => isActive(href))?.[1] ?? null)
    : null;
  const indicatorTarget = hovered ?? activeHref;
  useEffect(() => {
    const measure = () => {
      const nav = navRef.current;
      const el = indicatorTarget ? linkRefs.current[indicatorTarget] : null;
      const rect = el?.getBoundingClientRect();
      const navRect = nav?.getBoundingClientRect();
      if (!rect || !navRect || rect.width === 0) {
        setIndicator((prev) =>
          prev.visible ? { ...prev, visible: false } : prev,
        );
        return;
      }
      setIndicator({
        left: rect.left - navRect.left,
        width: rect.width,
        visible: true,
      });
    };
    measure();
    document.fonts.ready.then(measure).catch(() => undefined);
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [indicatorTarget, path]);
  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <Logo />
          <nav
            ref={navRef}
            className="desktop-nav"
            aria-label="Primary navigation"
            onMouseLeave={() => setHovered(null)}
          >
            {!admin &&
              headerNav.map(([label, href]) => (
                <Link
                  ref={(node) => {
                    linkRefs.current[href] = node;
                  }}
                  aria-current={isActive(href) ? "page" : undefined}
                  key={href}
                  href={href}
                  onMouseEnter={() => setHovered(href)}
                >
                  {label}
                </Link>
              ))}
            {!admin && (
              <span
                className={`nav-indicator${indicator.visible ? " is-visible" : ""}`}
                aria-hidden="true"
                style={{ left: indicator.left, width: indicator.width }}
              />
            )}
          </nav>
          <div className="header-actions">
            {!admin && (
              <Link className="button small" href="/book">
                Book Now <ArrowUpRight size={16} />
              </Link>
            )}
            {admin && (
              <Link
                className="button small danger admin-signout"
                href="/admin/login"
                onClick={() => sessionStorage.removeItem("wave-demo-session")}
              >
                <LogOut size={16} />
                Sign Out
              </Link>
            )}
            <button
              className="icon-button"
              aria-label="Open menu"
              aria-expanded={open}
              onClick={() => setOpen(true)}
            >
              <Menu />
            </button>
          </div>
        </div>
      </header>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={admin ? "Console navigation" : "Menu"}
        className={`navigation-dialog ${admin ? "admin-menu" : ""}`}
      >
        <Logo large={admin} label />
        {admin && (
          <>
            <p className="eyebrow centred">Operations & stewardship</p>
            <div className="laundry-icons" aria-hidden="true">
              <WashingMachine />
              <Shirt />
              <WashingMachine />
              <Shirt />
              <WashingMachine />
            </div>
          </>
        )}
        <nav aria-label={admin ? "Admin navigation" : "Mobile navigation"}>
          {links.map(([label, href], i) => {
            const Icon = adminIcons[i];
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={[
                  path === href ? "active" : "",
                  !admin && headerNavLabels.includes(label) ? "in-header" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-current={path === href ? "page" : undefined}
              >
                {admin && Icon && <Icon size={22} />}
                <span>{label}</span>
                {path === href ? (
                  <small>Active</small>
                ) : (
                  <ArrowUpRight size={20} />
                )}
              </Link>
            );
          })}
        </nav>
        <ThemeControl />
        {!admin ? (
          <div className="menu-actions">
            <Link
              className="button"
              href="/book"
              onClick={() => setOpen(false)}
            >
              Book a Pickup
            </Link>
            <Link
              className="button secondary"
              href="/locations"
              onClick={() => setOpen(false)}
            >
              Visit a Branch
            </Link>
            <a className="button whatsapp" href={contact.whatsapp}>
              Chat on WhatsApp
            </a>
            <a href={contact.tel}>{contact.phone}</a>
          </div>
        ) : (
          <div className="menu-actions">
            <Link
              className="button secondary"
              href="/"
              onClick={() => setOpen(false)}
            >
              Return Home <ArrowUpRight size={18} />
            </Link>
            <Link
              className="button danger"
              href="/admin/login"
              onClick={() => {
                sessionStorage.removeItem("wave-demo-session");
                setOpen(false);
              }}
            >
              <LogOut size={18} />
              Sign Out
            </Link>
          </div>
        )}
      </Dialog>
    </>
  );
}
export function Footer() {
  const path = usePathname();
  if (path.startsWith("/admin"))
    return (
      <footer className="admin-footer">
        <BrandText
          text={`© ${new Date().getFullYear()} 2nd Wave Laundry Services.`}
        />
      </footer>
    );
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <Logo />
          <h2>A Redefined Laundry Experience</h2>
          <p>
            <BrandText text="2nd Wave Laundry Services" />
          </p>
          <a className="text-link" href={contact.tel}>
            {contact.phone}
          </a>
        </div>
        <div>
          <h3>Explore</h3>
          {publicNav.slice(1, 6).map(([label, href]) => (
            <Link key={href} href={href}>
              {label}
            </Link>
          ))}
        </div>
        <div>
          <h3>Get in touch</h3>
          {publicNav.slice(6).map(([label, href]) => (
            <Link key={href} href={href}>
              {label}
            </Link>
          ))}
          <Link href="/reviews">Customer Reviews</Link>
          <a href={contact.whatsapp}>Chat on WhatsApp</a>
        </div>
        <div>
          <h3>Follow along</h3>
          <a href={contact.instagram} target="_blank" rel="noreferrer">
            Instagram ↗
          </a>
          <a href={contact.tiktok} target="_blank" rel="noreferrer">
            TikTok ↗
          </a>
          <ThemeControl />
        </div>
      </div>
      <div className="container footer-bottom">
        <small>
          <BrandText
            text={`© ${new Date().getFullYear()} 2nd Wave Laundry Services.`}
          />
        </small>
        <div>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms & Conditions</Link>
          <Link href="/laundry-care-terms">Laundry Care Terms</Link>
        </div>
      </div>
    </footer>
  );
}
export function DemoBanner() {
  return demoMode ? (
    <div className="demo-banner">
      Frontend preview · Use sample details only. No requests, messages or
      payments are sent.<Link href="/preview">Review states ↗</Link>
    </div>
  ) : null;
}
export function AdminSidebar() {
  const path = usePathname();
  return (
    <aside className="admin-sidebar">
      <p className="eyebrow">Workspace</p>
      <nav>
        {adminNav.map(([label, href], i) => {
          const Icon = adminIcons[i];
          return (
            <Link
              key={href}
              href={href}
              className={
                (href === "/admin" ? path === href : path.startsWith(href))
                  ? "active"
                  : ""
              }
            >
              <Icon size={20} />
              {label}
            </Link>
          );
        })}
      </nav>
      <ThemeControl />
      <Link className="text-link" href="/">
        Return Home ↗
      </Link>
      <Link
        className="text-link"
        href="/admin/login"
        onClick={() => sessionStorage.removeItem("wave-demo-session")}
      >
        Sign Out
      </Link>
    </aside>
  );
}
