/**
 * Render one of our own print pages to a real PDF, using headless Chrome.
 *
 * WHY THIS EXISTS
 * PPK, 2026-09-02: "when i press download button printer must show the save
 * print but showing last selected one."
 *
 * It never could. A web page cannot choose the print destination —
 * window.print() takes no arguments and Chrome opens on whatever was used
 * last, by design. So "Download PDF" and "Print" both landed on his RICOH.
 * The only fix is to stop asking the browser to print and produce the file
 * on the server instead.
 *
 * WHY HEADLESS CHROME RATHER THAN DRAWING THE PDF
 * pdfkit is already a dependency and would be lighter. But it would mean
 * drawing the GST invoice a SECOND time, in code, beside the HTML print
 * page — two implementations of one layout, free to drift. That is the
 * exact failure this codebase keeps paying for: the fitter wage that read
 * Rs 2,400 on screen and Rs 4,000 in the export, and the TDS that read
 * three different ways across four screens. Chrome renders the same page
 * the operator is looking at, so there is only ever one layout.
 */
import type { Browser } from 'puppeteer-core';

/**
 * Paths we are willing to render. Anchored patterns, not a prefix test.
 *
 * This is a security boundary, not tidiness. The route takes a path from
 * the query string and fetches it with the CALLER'S OWN SESSION COOKIES
 * attached — so an unvalidated path would turn this endpoint into a proxy
 * that reads any URL as the signed-in user. Every pattern below is
 * absolute, internal, and ends at a known print page.
 */
const ALLOWED_PATHS: RegExp[] = [
  /^\/app\/invoices\/\d+\/print$/,
  /^\/app\/delivery-challan\/\d+\/print$/,
  /^\/app\/parties\/\d+\/statement\/print$/,
  /^\/app\/ledgers\/print$/,
  /^\/app\/reports\/agent-commission\/print$/,
];

/** True when `path` is one of our print pages. Query string is checked
 *  separately by the caller — only the pathname is matched here. */
export function isRenderablePath(path: string): boolean {
  return ALLOWED_PATHS.some((re) => re.test(path));
}

/**
 * Where the Chromium binary comes from on Vercel.
 *
 * The first attempt used @sparticuz/chromium, which ships 66 MB of Brotli
 * archives inside the package and unpacks them to /tmp. It failed on
 * deploy: "The input directory /var/task/app/node_modules/.pnpm/
 * @sparticuz+chromium…/bin does not exist". serverExternalPackages did not
 * help, and neither did outputFileTracingIncludes — Next's trace files list
 * none of it, and the same is true of pdfkit, which nonetheless works. In
 * other words the packaging behaviour here is not something this repo can
 * verify before deploying, and it had already cost two failed builds.
 *
 * chromium-min removes the question entirely: the package is JavaScript
 * only, and the binary is fetched at runtime from a URL. Nothing to trace,
 * nothing to relocate, nothing that can be silently pruned.
 *
 * The cost is a ~50 MB download on a cold container, a few seconds, and a
 * dependency on that URL being reachable. CHROMIUM_PACK_URL overrides it —
 * worth pointing at Supabase storage if GitHub ever proves flaky or slow.
 * The version MUST match the installed @sparticuz/chromium-min.
 */
const CHROMIUM_PACK_URL =
  process.env.CHROMIUM_PACK_URL ??
  'https://github.com/Sparticuz/chromium/releases/download/v149.0.0/chromium-v149.0.0-pack.x64.tar';

/**
 * Chrome's location differs by environment:
 *  - On Vercel there is no browser, so chromium-min downloads one.
 *  - Locally we use whatever Chrome the developer already has, because
 *    downloading a second 300 MB copy to run `npm run dev` is rude.
 *    CHROME_PATH overrides, for anyone whose install is elsewhere.
 */
async function launchBrowser(): Promise<Browser> {
  const puppeteer = (await import('puppeteer-core')).default;
  const onServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

  if (onServerless) {
    const chromium = (await import('@sparticuz/chromium-min')).default;
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(CHROMIUM_PACK_URL),
      headless: true,
    }) as unknown as Browser;
  }

  const local =
    process.env.CHROME_PATH ??
    [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
    ].find((p) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require('node:fs').existsSync(p);
      } catch {
        return false;
      }
    });

  if (!local) {
    throw new Error(
      'No Chrome found for PDF rendering. Install Google Chrome, or set CHROME_PATH to its executable.',
    );
  }

  return puppeteer.launch({
    executablePath: local,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  }) as unknown as Browser;
}

export interface RenderOptions {
  /** Absolute URL of the print page, on our own origin. */
  url: string;
  /** Cookie header from the incoming request, so the page loads as the
   *  signed-in user rather than bouncing to the login screen. */
  cookie: string;
}

/** Renders `url` to an A4 PDF. Throws if the page fails to load. */
export async function renderPageToPdf({ url, cookie }: RenderOptions): Promise<Uint8Array> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();

    // The session travels as a header rather than via setCookie() because
    // we are handing back exactly what the browser sent us, without having
    // to parse or re-domain each cookie.
    if (cookie) await page.setExtraHTTPHeaders({ cookie });

    // 'networkidle0' rather than 'load': these pages fetch their data after
    // hydration, and 'load' fires while the tables are still empty — which
    // produced a beautifully rendered PDF of a page with no rows in it.
    const res = await page.goto(url, { waitUntil: 'networkidle0', timeout: 45_000 });
    if (!res || !res.ok()) {
      throw new Error(`Print page returned ${res ? res.status() : 'no response'}`);
    }

    // An expired session does not fail — it REDIRECTS to the sign-in page,
    // which returns a perfectly good 200. Without this check the operator
    // would get a crisp A4 PDF of the login screen and no explanation.
    const landed = new URL(page.url()).pathname;
    if (landed !== new URL(url).pathname) {
      throw new Error(
        `Session expired or no access to this page (ended up at ${landed}). Sign in again and retry.`,
      );
    }

    // The print pages hide their toolbar under @media print, and Chrome's
    // pdf() applies print styles, so the toolbar drops out on its own.
    await page.emulateMediaType('print');

    // Wait out any full-screen overlay before shooting the page.
    //
    // The launch splash is a fixed navy panel that clears itself after
    // about two seconds. networkidle0 goes quiet long before that, so the
    // first PDF was a picture of the splash with the invoice underneath.
    // launch-splash.tsx no longer renders on /print at all, which is the
    // real fix; this is the second lock, because "the page is finished
    // loading" and "the page is finished ANIMATING" are different claims
    // and only the first one has an event.
    await page
      .waitForFunction(() => !document.querySelector('.ppk-splash'), { timeout: 5_000 })
      .catch(() => { /* no splash, or it outlived the wait — carry on */ });

    return await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    });
  } finally {
    // Always: a leaked Chrome on a serverless host survives the response
    // and eats the function's memory on the next invocation.
    await browser.close().catch(() => {});
  }
}
