/**
 * GET /app/api/pdf?path=/app/invoices/123/print&filename=ABC%20TEX%20INV-1.pdf
 *
 * (Under /app, not /api — the App Router directory in this project is
 * app/app, so every route lives beneath /app. Same as the weekly wage PDF
 * export, whose own header comment says /api/... and is wrong.)
 *
 * Returns a real PDF file of one of our print pages, as a download.
 *
 * Replaces the old "Download PDF" button, which called window.print() and
 * could only ever open the browser's print dialog on whatever destination
 * was used last — PPK's RICOH, in his case. A page cannot choose the print
 * destination; producing the file server-side is the only way to make a
 * Download button actually download.
 *
 * SECURITY
 * This endpoint fetches `path` while attaching the CALLER'S OWN session
 * cookies. Unvalidated, that is a proxy that reads arbitrary URLs as the
 * signed-in user. Two things keep it closed:
 *
 *   1. `path` is matched against an anchored allowlist of our own print
 *      pages (isRenderablePath). Not a prefix check — an absolute pattern
 *      per page, so `/app/invoices/1/print/../../secrets` cannot pass.
 *   2. The URL is rebuilt from THIS request's own origin. The caller
 *      supplies a path, never a host, so it cannot be pointed off-site
 *      even if the allowlist were wrong.
 *
 * The cookies are the caller's own, so the PDF shows exactly what that user
 * would see on screen — no privilege is gained by going through Chrome.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { isRenderablePath, renderPageToPdf } from '@/lib/pdf/render-page';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Chromium cold-start plus a data-heavy statement can exceed the default
// 15s. Vercel caps this by plan; 60 is accepted on all current tiers.
export const maxDuration = 60;

/** Strips anything that would break a Content-Disposition header or a
 *  Windows filename, then guarantees a .pdf suffix. */
function safeFilename(raw: string | null): string {
  const base = (raw ?? 'document')
    .replace(/[\\/:*?"<>|\r\n]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  const clean = base === '' ? 'document' : base;
  return clean.toLowerCase().endsWith('.pdf') ? clean : `${clean}.pdf`;
}

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const rawPath = url.searchParams.get('path') ?? '';
  const filename = safeFilename(url.searchParams.get('filename'));

  // Split path from its query string before matching: the allowlist
  // describes pages, and several of them take legitimate parameters
  // (?from=&to= on a ledger, for instance).
  const parts = rawPath.split('?');
  const pathname = parts[0] ?? '';
  const search = parts.slice(1).join('?');

  if (!pathname.startsWith('/') || pathname.includes('..') || !isRenderablePath(pathname)) {
    return NextResponse.json(
      { error: 'Not a printable page.', path: pathname },
      { status: 400 },
    );
  }

  // Origin comes from THIS request, never from the caller's input.
  const target = `${url.origin}${pathname}${search ? `?${search}` : ''}`;

  try {
    const pdf = await renderPageToPdf({
      url: target,
      cookie: req.headers.get('cookie') ?? '',
    });

    return new Response(Buffer.from(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        // `attachment` is the whole point — this is what makes the browser
        // save the file instead of opening a print dialog.
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'PDF rendering failed.';
    // Surfaced rather than swallowed: "no Chrome installed" and "the print
    // page 500'd" need different fixes, and a generic failure hides which.
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
