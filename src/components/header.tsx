import Link from "next/link";

export function Header() {
  return (
    <header className="site-header">
      <div>
        <Link href="/" className="brand-mark">
          Repertory Signal
        </Link>
        <p className="brand-subtitle">NYC repertory, arthouse, museum, and specialty-format showtimes</p>
      </div>
      <nav className="main-nav">
        <Link href="/">Search</Link>
        <Link href="/calendar">Calendar</Link>
        <Link href="/venues/ifc-center">Venues</Link>
        <Link href="/tags/35mm">Tags</Link>
      </nav>
    </header>
  );
}
