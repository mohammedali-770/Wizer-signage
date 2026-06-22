import ExcelJS from 'exceljs';

/**
 * Shared tabular I/O for Phase 10 imports/exports/reports.
 *
 * - CSV: hand-rolled RFC-4180 reader/writer (no dependency), with formula-
 *   injection hardening on write.
 * - XLSX: exceljs read/write (first worksheet).
 * - "PDF": a print-optimized HTML document the browser prints to PDF (the
 *   spec-sanctioned fallback — no native PDF engine pulled in).
 */

export type Cell = string | number | boolean | null | undefined;

// --- CSV ---------------------------------------------------------------------

/** Escape a single CSV cell (RFC-4180 + spreadsheet formula-injection guard). */
export function csvCell(value: Cell): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // defuse formula injection
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  return lines.join('\r\n');
}

/**
 * Parse CSV text into a matrix of string cells. Handles quoted fields with
 * embedded commas, quotes ("" → "), and CR/LF/CRLF line endings. A trailing
 * blank line is ignored. Leading apostrophes added by csvCell are NOT stripped
 * (they only appear on values we wrote ourselves).
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  // Strip a UTF-8 BOM if present.
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    // Ignore wholly-blank lines (matches the documented contract).
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      pushField();
      i++;
      continue;
    }
    if (c === '\r') {
      if (text[i + 1] === '\n') i++;
      pushRow();
      i++;
      continue;
    }
    if (c === '\n') {
      pushRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // Flush the final field/row unless the input ended exactly on a newline.
  if (field.length > 0 || row.length > 0) pushRow();
  return rows;
}

// --- XLSX --------------------------------------------------------------------

export async function toXlsx(
  sheetName: string,
  headers: string[],
  rows: Cell[][],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName.slice(0, 31) || 'Sheet1');
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };
  for (const row of rows) ws.addRow(row.map((c) => (c === undefined ? null : c)));
  const out = await wb.xlsx.writeBuffer();
  // exceljs returns a Node Buffer at runtime; normalize the type for callers.
  return Buffer.from(out as ArrayBuffer) as unknown as Buffer;
}

/** Read the first worksheet of an XLSX buffer into a string matrix (incl. header row). */
export async function parseXlsx(buffer: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (excelRow) => {
    const values = excelRow.values as unknown[]; // index 0 is unused by exceljs
    const cells: string[] = [];
    for (let c = 1; c < values.length; c++) {
      const v = values[c];
      cells.push(v === null || v === undefined ? '' : cellToString(v));
    }
    rows.push(cells);
  });
  return rows;
}

function cellToString(v: unknown): string {
  if (typeof v === 'object' && v !== null) {
    // exceljs rich text / hyperlink / formula result objects.
    const obj = v as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.result !== 'undefined') return String(obj.result);
    if (obj instanceof Date) return (v as Date).toISOString();
  }
  return String(v);
}

// --- Print-HTML ("PDF") ------------------------------------------------------

const htmlEscape = (s: Cell): string =>
  String(s ?? '').replace(
    /[&<>"]/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] as string,
  );

/**
 * A self-contained, print-optimized HTML document. Served as text/html; the
 * operator prints it to PDF from the browser. Documented as the PDF fallback.
 */
export function toPrintHtml(
  title: string,
  headers: string[],
  rows: Cell[][],
  subtitle?: string,
): string {
  const head = headers.map((h) => `<th>${htmlEscape(h)}</th>`).join('');
  const body = rows
    .map((r) => `<tr>${r.map((c) => `<td>${htmlEscape(c)}</td>`).join('')}</tr>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(title)}</title>
<style>
  body{font-family:system-ui,Arial,sans-serif;color:#111;margin:32px;}
  h1{font-size:20px;margin:0 0 4px;} .sub{color:#666;margin:0 0 16px;font-size:13px;}
  table{border-collapse:collapse;width:100%;font-size:12px;}
  th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top;}
  th{background:#f4f4f5;} tr:nth-child(even) td{background:#fafafa;}
  @media print{body{margin:8mm;} .noprint{display:none;}}
</style></head><body>
<h1>${htmlEscape(title)}</h1>
${subtitle ? `<p class="sub">${htmlEscape(subtitle)}</p>` : ''}
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
<p class="noprint" style="margin-top:16px;color:#888;font-size:12px;">Use your browser's Print → Save as PDF to export this report.</p>
</body></html>`;
}

/** Content-Type for a given report format. */
export const FORMAT_CONTENT_TYPE: Record<string, string> = {
  CSV: 'text/csv; charset=utf-8',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  PDF: 'text/html; charset=utf-8',
};

export const FORMAT_EXTENSION: Record<string, string> = { CSV: 'csv', XLSX: 'xlsx', PDF: 'html' };
