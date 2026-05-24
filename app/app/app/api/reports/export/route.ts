// POST /api/reports/export
//
// Generic Excel-export endpoint for every report page. A report page hands the
// already-filtered, already-sorted rows it just rendered, plus a column spec,
// to the <ExcelExportButton> client component. The button POSTs that payload
// here, and this route streams back a styled .xlsx workbook as a download.
//
// The workbook generator (lib/xlsx.ts) is dependency-free, so this route needs
// no npm packages beyond Next.js itself.

import { NextResponse } from 'next/server';
import { buildXlsx, type ExcelColumn, type CellType } from '@/lib/xlsx';

// Route handlers run on the Node.js runtime by default, which is what we want:
// buildXlsx() uses node:zlib. Pin it explicitly so a future config change does
// not silently move this onto the Edge runtime.
export const runtime = 'nodejs';

const CELL_TYPES: ReadonlyArray<CellType> = [
  'text',
  'number',
  'rupee',
  'metre',
  'percent',
  'date',
];

interface ExportRequest {
  filename: string;
  sheetName: string;
  title?: string;
  columns: ExcelColumn[];
  rows: ReadonlyArray<Record<string, unknown>>;
}

function isCellType(value: unknown): value is CellType {
  return typeof value === 'string' && CELL_TYPES.includes(value as CellType);
}

// Validate and normalise the untrusted request body into an ExportRequest.
// Returns a string describing the first problem, or the clean payload.
function parseBody(body: unknown): ExportRequest | string {
  if (typeof body !== 'object' || body === null) {
    return 'Request body must be a JSON object.';
  }
  const b = body as Record<string, unknown>;

  if (!Array.isArray(b.columns) || b.columns.length === 0) {
    return 'columns must be a non-empty array.';
  }
  if (!Array.isArray(b.rows)) {
    return 'rows must be an array.';
  }

  const columns: ExcelColumn[] = [];
  for (const raw of b.columns) {
    if (typeof raw !== 'object' || raw === null) {
      return 'Each column must be an object.';
    }
    const c = raw as Record<string, unknown>;
    if (typeof c.key !== 'string' || c.key.length === 0) {
      return 'Each column needs a non-empty string key.';
    }
    if (typeof c.label !== 'string') {
      return 'Each column needs a string label.';
    }
    const col: ExcelColumn = { key: c.key, label: c.label };
    if (isCellType(c.type)) col.type = c.type;
    if (typeof c.width === 'number' && Number.isFinite(c.width)) {
      col.width = c.width;
    }
    if (c.total === true) col.total = true;
    columns.push(col);
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const raw of b.rows) {
    if (typeof raw !== 'object' || raw === null) {
      return 'Each row must be an object.';
    }
    rows.push(raw as Record<string, unknown>);
  }

  const filename =
    typeof b.filename === 'string' && b.filename.trim().length > 0
      ? b.filename.trim()
      : 'report';
  const sheetName =
    typeof b.sheetName === 'string' && b.sheetName.trim().length > 0
      ? b.sheetName.trim()
      : 'Sheet1';
  const title = typeof b.title === 'string' ? b.title : undefined;

  return { filename, sheetName, title, columns, rows };
}

// Strip anything that could break a Content-Disposition header, and make sure
// the name ends in .xlsx.
function safeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9 _.\-]/g, '_').slice(0, 120);
  const base = cleaned.toLowerCase().endsWith('.xlsx')
    ? cleaned
    : cleaned + '.xlsx';
  return base;
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Request body must be valid JSON.' },
      { status: 400 }
    );
  }

  const parsed = parseBody(body);
  if (typeof parsed === 'string') {
    return NextResponse.json({ ok: false, error: parsed }, { status: 400 });
  }

  try {
    const buffer = buildXlsx({
      sheetName: parsed.sheetName,
      title: parsed.title,
      columns: parsed.columns,
      rows: parsed.rows,
    });

    const filename = safeFilename(parsed.filename);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Failed to build the workbook.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
