"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function Header() {
  const pathname = usePathname();
  const isUpcomingActive = pathname === "/" || pathname.startsWith("/films/") || pathname.startsWith("/tags/");
  const isCalendarActive = pathname.startsWith("/calendar");
  const isVenueActive = pathname.startsWith("/venues");

  return (
    <header className="site-header">
      <div className="brand-block">
        <Link href="/" className="brand-mark" aria-label="Screen Ritual home">
          <Image
            src="/screen-ritual-logo.svg"
            alt="Screen Ritual"
            width={1352}
            height={322}
            className="brand-logo"
            priority
          />
        </Link>
        <p className="brand-subtitle">NYC repertory, arthouse, museum, and specialty-format showtimes</p>
      </div>
      <nav className="main-nav">
        <Link href="/projection-room">Projection Room</Link>
        <Link href="/" className={`ticket-nav-link ${isUpcomingActive ? "active-section" : ""}`.trim()}>
          <Image
            src="/upcoming-films-ticket-button.svg"
            alt="Upcoming Films"
            width={658}
            height={288}
            className="ticket-nav-image"
          />
        </Link>
        <Link href="/calendar" className={`ticket-nav-link ${isCalendarActive ? "active-section" : ""}`.trim()}>
          <Image
            src="/calendar-ticket-button.svg"
            alt="Calendar"
            width={658}
            height={288}
            className="ticket-nav-image"
          />
        </Link>
        <Link href="/places">Places</Link>
        <Link href="/venues" className={`ticket-nav-link ${isVenueActive ? "active-section" : ""}`.trim()}>
          <Image
            src="/by-theater-ticket-button.svg"
            alt="By Theater"
            width={658}
            height={288}
            className="ticket-nav-image"
          />
        </Link>
        <Link href="/tags/35mm">Tags</Link>
      </nav>
    </header>
  );
}
