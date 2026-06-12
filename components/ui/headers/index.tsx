import Link from "next/link";
import type { JSX } from "react";

// ---- Back link button ----

export function BackLink({ href, label }: { href: string; label: string }): JSX.Element {
  return (
    <Link
      href={href}
      className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
      aria-label={label}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6" />
      </svg>
    </Link>
  );
}

// ---- Simple static page header ----

export function SimplePageHeader({ title, subtitle }: { title: string; subtitle?: string }): JSX.Element {
  return (
    <div>
      <h1 className="text-lg font-semibold leading-tight">{title}</h1>
      {subtitle && <p className="text-xs text-ink-400">{subtitle}</p>}
    </div>
  );
}

// ---- Back-link + title header ----

export function BackPageHeader({
  backHref,
  backLabel,
  title,
  subtitle,
}: {
  backHref: string;
  backLabel: string;
  title: string;
  subtitle?: string;
}): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <BackLink href={backHref} label={backLabel} />
      <SimplePageHeader title={title} subtitle={subtitle} />
    </div>
  );
}

// ---- Skeleton ----

export function HeaderSkeleton({
  titleW = 32,
  subtitleW = 48,
  hasBackButton = true,
}: {
  titleW?: number;
  subtitleW?: number;
  hasBackButton?: boolean;
}): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      {hasBackButton && <div className="h-8 w-8 animate-pulse rounded-lg bg-ink-200" />}
      <div className="space-y-2">
        <div className="h-5 animate-pulse rounded bg-ink-200" style={{ width: `${titleW * 4}px` }} />
        <div className="h-3 animate-pulse rounded bg-ink-100" style={{ width: `${subtitleW * 4}px` }} />
      </div>
    </div>
  );
}
