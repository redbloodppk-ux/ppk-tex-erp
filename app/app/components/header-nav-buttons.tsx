'use client';
/**
 * Home + Back buttons surfaced on every page via PageHeader.
 *
 * Client component because Back needs router.back(). Home is just a Link
 * back to the app dashboard.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Home } from 'lucide-react';

export function HeaderNavButtons(): React.ReactElement {
  const router = useRouter();
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <button
        type="button"
        onClick={() => router.back()}
        className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-[11px] font-semibold text-ink-soft hover:bg-haze/60"
        aria-label="Go back"
        title="Go back"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </button>
      <Link
        href="/app"
        className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-[11px] font-semibold text-ink-soft hover:bg-haze/60"
        aria-label="Go to home"
        title="Home"
      >
        <Home className="w-3.5 h-3.5" /> Home
      </Link>
    </div>
  );
}
