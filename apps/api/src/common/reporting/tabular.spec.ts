import { csvCell, parseCsv, toCsv } from './tabular';

describe('tabular CSV', () => {
  it('escapes quotes, commas, and newlines on write', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('defuses spreadsheet formula injection', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@cmd')).toBe("'@cmd");
  });

  it('round-trips a matrix through toCsv → parseCsv', () => {
    const headers = ['name', 'note'];
    const rows = [
      ['Main', 'has, comma'],
      ['Quote', 'say "hi"'],
      ['Multi', 'line1\nline2'],
    ];
    const csv = toCsv(headers, rows);
    const parsed = parseCsv(csv);
    expect(parsed[0]).toEqual(headers);
    expect(parsed[1]).toEqual(['Main', 'has, comma']);
    expect(parsed[2]).toEqual(['Quote', 'say "hi"']);
    expect(parsed[3]).toEqual(['Multi', 'line1\nline2']);
  });

  it('ignores wholly-blank lines (mid and trailing)', () => {
    expect(parseCsv('a,b\r\n\r\n1,2\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles a trailing newline and CRLF endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips a UTF-8 BOM', () => {
    expect(parseCsv('﻿a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});
