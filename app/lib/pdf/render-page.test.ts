import { describe, it, expect } from 'vitest';
import { isRenderablePath } from './render-page';

/**
 * The allowlist is a security boundary, not a convenience.
 *
 * /app/api/pdf fetches the path it is given while attaching the CALLER'S
 * OWN session cookies. If a path that is not one of our print pages could
 * get through, the endpoint would read that URL as the signed-in user and
 * hand back the result as a PDF. So the interesting tests here are the
 * refusals, not the acceptances.
 */
describe('isRenderablePath — accepts our print pages', () => {
  it.each([
    '/app/invoices/1/print',
    '/app/invoices/99123/print',
    '/app/delivery-challan/42/print',
    '/app/parties/19/statement/print',
    '/app/ledgers/print',
    '/app/reports/agent-commission/print',
  ])('%s', (p) => {
    expect(isRenderablePath(p)).toBe(true);
  });
});

describe('isRenderablePath — refuses everything else', () => {
  it.each([
    // Ordinary app pages. A statement is printable; the party EDIT form is
    // not, and rendering it would leak a form full of data as a document.
    ['a normal app page',        '/app/dashboard'],
    ['the party edit form',      '/app/parties/19'],
    ['the attendance screen',    '/app/attendance/mark'],
    // Traversal, encoded and plain. The route also rejects ".." outright,
    // but the pattern must not depend on that second line of defence.
    ['dot-dot traversal',        '/app/invoices/1/print/../../../etc/passwd'],
    ['trailing traversal',       '/app/ledgers/print/..'],
    // Anything off our own origin. The route rebuilds the URL from its own
    // origin so a host here is inert, but it must never match regardless.
    ['an absolute http url',     'https://example.com/'],
    ['a protocol-relative url',  '//example.com/app/ledgers/print'],
    ['a file url',               'file:///etc/passwd'],
    // Near-misses on real pages.
    ['no id on the invoice',     '/app/invoices//print'],
    ['a non-numeric id',         '/app/invoices/abc/print'],
    ['print as a prefix only',   '/app/invoices/1/printer-settings'],
    ['a suffix after print',     '/app/ledgers/print/secret'],
    ['the api route itself',     '/app/api/pdf'],
    ['empty',                    ''],
  ])('refuses %s', (_label, p) => {
    expect(isRenderablePath(p)).toBe(false);
  });

  it('refuses a query string smuggled into the pathname', () => {
    // The route splits path from query BEFORE calling this, so a '?' here
    // means someone bypassed that split — it must not match.
    expect(isRenderablePath('/app/ledgers/print?id=1')).toBe(false);
  });
});
