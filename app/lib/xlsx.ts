/**
 * lib/xlsx.ts — dependency-free .xlsx workbook generator.
 *
 * The deployment environment cannot `npm install` extra packages, so this
 * module writes a styled Office Open XML spreadsheet by hand: it emits the
 * handful of XML parts an .xlsx needs and packs them into a ZIP container
 * using only Node's built-in `zlib`.
 *
 * Supports both single-sheet workbooks (via `buildXlsx`) and multi-sheet
 * workbooks (via `buildXlsxWorkbook`). Each sheet gets a header row, optional
 * title row, optional totals row, and a few number formats (plain number,
 * rupee, metre, percent, date).
 */
import { deflateRawSync } from 'node:zlib';

export type CellType = 'text' | 'number' | 'rupee' | 'metre' | 'percent' | 'date';

export interface ExcelColumn {
  /** key into each row object */
  key: string;
  /** column header label */
  label: string;
  /** value formatting (default 'text') */
  type?: CellType;
  /** column width in characters (default derived from the label) */
  width?: number;
  /** include this column in the totals row */
  total?: boolean;
}

export interface SheetSpec {
  sheetName: string;
  columns: ExcelColumn[];
  rows: ReadonlyArray<Record<string, unknown>>;
  /** optional bold title shown in row 1 */
  title?: string;
}

export interface WorkbookSpec {
  sheets: ReadonlyArray<SheetSpec>;
}

/* ───────────────────────── ZIP container ───────────────────────── */

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = (CRC_TABLE[(c ^ (buf[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

function buildZip(entries: ReadonlyArray<ZipEntry>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const compressed = deflateRawSync(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

/* ───────────────────────── helpers ───────────────────────── */

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function columnLetter(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

function toExcelDate(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Date.parse(String(value));
  if (Number.isNaN(parsed)) return null;
  return Math.floor((parsed - EXCEL_EPOCH_UTC) / 86_400_000);
}

function toNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/* style index per cell type — see styles.xml below */
const TYPE_STYLE: Record<CellType, number> = {
  text: 2,
  number: 3,
  rupee: 4,
  metre: 5,
  percent: 6,
  date: 7,
};
const TOTAL_STYLE: Record<CellType, number> = {
  text: 8,
  number: 9,
  rupee: 10,
  metre: 11,
  percent: 13,
  date: 8,
};

/* styles.xml — fonts, number formats and cell styles (indexes 0-13) */
const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="5">' +
  '<numFmt numFmtId="164" formatCode="&quot;\u20b9&quot;#,##0"/>' +
  '<numFmt numFmtId="165" formatCode="#,##0.0&quot; m&quot;"/>' +
  '<numFmt numFmtId="166" formatCode="0.0&quot;%&quot;"/>' +
  '<numFmt numFmtId="167" formatCode="dd\\-mmm\\-yyyy"/>' +
  '<numFmt numFmtId="168" formatCode="#,##0"/>' +
  '</numFmts>' +
  '<fonts count="3">' +
  '<font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="14"/><name val="Calibri"/></font>' +
  '</fonts>' +
  '<fills count="3">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFEDEDED"/><bgColor indexed="64"/></patternFill></fill>' +
  '</fills>' +
  '<borders count="2">' +
  '<border><left/><right/><top/><bottom/><diagonal/></border>' +
  '<border><left/><right/><top/><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>' +
  '</borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="14">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="168" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="168" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
  '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
  '<xf numFmtId="165" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="166" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

function numberCell(ref: string, style: number, value: number): string {
  return '<c r="' + ref + '" s="' + style + '"><v>' + value + '</v></c>';
}

function textCell(ref: string, style: number, value: string): string {
  return (
    '<c r="' + ref + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' +
    escapeXml(value) +
    '</t></is></c>'
  );
}

function emptyCell(ref: string, style: number): string {
  return '<c r="' + ref + '" s="' + style + '"/>';
}

/* ───────────────────────── workbook builder ───────────────────────── */

/** Sanitise + truncate a sheet name per Excel rules (<=31 chars). */
function sanitiseSheetName(raw: string): string {
  return (raw || 'Sheet').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
}

/**
 * Brand line stamped at the top of every exported sheet. Single source of
 * truth — change this once and every report, attendance file, wages export,
 * snapshot, etc. picks it up.
 */
const BRAND_LINE = 'PPK TEX';

/** Render a single sheet's worksheet XML body. */
function renderSheetXml(spec: SheetSpec): string {
  const columns = spec.columns;
  const rows = spec.rows;
  const hasTitle = typeof spec.title === 'string' && spec.title.trim().length > 0;
  const hasTotals = columns.some((c) => c.total === true);
  // Row layout: 1 = brand, 2 = optional sheet title, then header, then data.
  const titleRowNum = hasTitle ? 2 : 0;
  const headerRowNum = hasTitle ? 3 : 2;
  const firstDataRowNum = headerRowNum + 1;

  const xmlRows: string[] = [];

  // Row 1 — branded company line, always present.
  xmlRows.push('<row r="1">' + textCell('A1', 12, BRAND_LINE) + '</row>');

  if (hasTitle) {
    xmlRows.push(
      '<row r="' + titleRowNum + '">' + textCell('A' + titleRowNum, 8, spec.title as string) + '</row>',
    );
  }

  const headerCells = columns
    .map((col, i) => textCell(columnLetter(i) + headerRowNum, 1, col.label))
    .join('');
  xmlRows.push('<row r="' + headerRowNum + '">' + headerCells + '</row>');

  const totals: Array<number | null> = columns.map(() => null);

  rows.forEach((row, rowIdx) => {
    const rowNum = firstDataRowNum + rowIdx;
    const cells = columns
      .map((col, colIdx) => {
        const ref = columnLetter(colIdx) + rowNum;
        const type: CellType = col.type ?? 'text';
        const raw = row[col.key];
        const style = TYPE_STYLE[type];

        if (type === 'text') {
          if (raw == null || raw === '') return emptyCell(ref, style);
          return textCell(ref, style, String(raw));
        }
        if (type === 'date') {
          const serial = toExcelDate(raw);
          if (serial == null) {
            return raw == null || raw === ''
              ? emptyCell(ref, TYPE_STYLE.text)
              : textCell(ref, TYPE_STYLE.text, String(raw));
          }
          return numberCell(ref, style, serial);
        }
        const num = toNumber(raw);
        if (num == null) return emptyCell(ref, style);
        if (col.total === true) {
          totals[colIdx] = (totals[colIdx] ?? 0) + num;
        }
        return numberCell(ref, style, num);
      })
      .join('');
    xmlRows.push('<row r="' + rowNum + '">' + cells + '</row>');
  });

  if (hasTotals) {
    const totalRowNum = firstDataRowNum + rows.length;
    let labelPlaced = false;
    const cells = columns
      .map((col, colIdx) => {
        const ref = columnLetter(colIdx) + totalRowNum;
        const type: CellType = col.type ?? 'text';
        if (col.total === true && totals[colIdx] != null) {
          return numberCell(ref, TOTAL_STYLE[type], totals[colIdx] as number);
        }
        if (!labelPlaced && type === 'text') {
          labelPlaced = true;
          return textCell(ref, 8, 'TOTAL');
        }
        return emptyCell(ref, 8);
      })
      .join('');
    xmlRows.push('<row r="' + totalRowNum + '">' + cells + '</row>');
  }

  const colsXml = columns
    .map((col, i) => {
      const width = col.width ?? Math.min(40, Math.max(11, col.label.length + 3));
      return (
        '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + width +
        '" customWidth="1"/>'
      );
    })
    .join('');

  const lastCol = columnLetter(Math.max(0, columns.length - 1));
  const lastRowNum =
    firstDataRowNum + rows.length - 1 + (hasTotals ? 1 : 0);
  const dimension = 'A1:' + lastCol + Math.max(lastRowNum, headerRowNum);

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<dimension ref="' + dimension + '"/>' +
    '<sheetViews><sheetView workbookViewId="0">' +
    '<pane ySplit="' + headerRowNum + '" topLeftCell="A' + firstDataRowNum +
    '" activePane="bottomLeft" state="frozen"/>' +
    '</sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    '<cols>' + colsXml + '</cols>' +
    '<sheetData>' + xmlRows.join('') + '</sheetData>' +
    '</worksheet>'
  );
}

/**
 * Build a multi-sheet .xlsx workbook.
 *
 * Each SheetSpec becomes a tab at the bottom of the workbook. Sheet names are
 * sanitised and deduplicated to satisfy Excel's rules.
 */
export function buildXlsxWorkbook(spec: WorkbookSpec): Buffer {
  const sheets = spec.sheets;
  if (sheets.length === 0) {
    throw new Error('buildXlsxWorkbook: at least one sheet is required.');
  }

  // Excel forbids duplicate sheet names — disambiguate with a counter suffix.
  const usedNames: Set<string> = new Set();
  const finalSheetNames: string[] = sheets.map((sheet) => {
    let name = sanitiseSheetName(sheet.sheetName);
    if (usedNames.has(name.toLowerCase())) {
      let counter = 2;
      const base = name.slice(0, 28);
      let candidate = base + ' ' + counter;
      while (usedNames.has(candidate.toLowerCase())) {
        counter += 1;
        candidate = base + ' ' + counter;
      }
      name = candidate;
    }
    usedNames.add(name.toLowerCase());
    return name;
  });

  const sheetXmls: string[] = sheets.map((sheet) => renderSheetXml(sheet));

  const sheetsTags = finalSheetNames
    .map((name, i) =>
      '<sheet name="' + escapeXml(name) +
      '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>',
    )
    .join('');

  const workbookXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets>' + sheetsTags + '</sheets>' +
    '</workbook>';

  const sheetRelTags = finalSheetNames
    .map((_, i) =>
      '<Relationship Id="rId' + (i + 1) +
      '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ' +
      'Target="worksheets/sheet' + (i + 1) + '.xml"/>',
    )
    .join('');
  const stylesRelId = finalSheetNames.length + 1;
  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheetRelTags +
    '<Relationship Id="rId' + stylesRelId +
    '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';

  const sheetOverrides = finalSheetNames
    .map((_, i) =>
      '<Override PartName="/xl/worksheets/sheet' + (i + 1) +
      '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
    )
    .join('');
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheetOverrides +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>';

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rootRels, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbookXml, 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRels, 'utf8') },
    { name: 'xl/styles.xml', data: Buffer.from(STYLES_XML, 'utf8') },
  ];
  sheetXmls.forEach((xml, i) => {
    entries.push({
      name: 'xl/worksheets/sheet' + (i + 1) + '.xml',
      data: Buffer.from(xml, 'utf8'),
    });
  });

  return buildZip(entries);
}

/**
 * Build a single-sheet .xlsx workbook (kept for backward compatibility with
 * the reports export route). Internally delegates to buildXlsxWorkbook.
 */
export function buildXlsx(spec: SheetSpec): Buffer {
  return buildXlsxWorkbook({ sheets: [spec] });
}
