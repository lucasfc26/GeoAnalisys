import ExcelJS from 'exceljs';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CsvParser, parseCsv, sniffEncoding, widenType } from './import.parse';
import { openRows } from './import.stream';

const all = async (src: { rows: AsyncGenerator<unknown[]> }) => {
  const out: unknown[][] = [];
  for await (const r of src.rows) out.push(r);
  return out;
};

describe('importação em partes', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'geo-import-test-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('CSV em pedaços dá o mesmo resultado, mesmo cortando aspas e \\r\\n ao meio', () => {
    const text = 'ID;endereco;x\r\n1;"Rua A; nº 2";4,5\r\n2;"diz ""oi""\nlinha 2";9\r\n3;;\r\n';
    const whole = parseCsv(text);
    for (let size = 1; size <= 7; size++) {
      const out: string[][] = [];
      const p = new CsvParser(';');
      for (let i = 0; i < text.length; i += size) p.push(text.slice(i, i + size), out);
      p.end(out);
      expect(out.filter((r) => r.some((v) => v.trim()))).toEqual(whole);
    }
  });

  it('codificação: UTF-8 (mesmo cortado no meio de um caractere) ou Windows-1252', () => {
    const utf = Buffer.from('endereço;ação', 'utf8');
    expect(sniffEncoding(utf)).toBe('utf-8');
    expect(sniffEncoding(utf.subarray(0, 8))).toBe('utf-8');
    expect(sniffEncoding(Buffer.from([0x65, 0xe7, 0x61]))).toBe('windows-1252');
  });

  it('tipo detectado alarga: inteiro → decimal → texto', () => {
    expect(widenType('integer', 5)).toBe('integer');
    expect(widenType('integer', '2,5')).toBe('number');
    expect(widenType('number', 'abc')).toBe('text');
    expect(widenType('text', 1)).toBe('text');
    expect(widenType('number', null)).toBe('number');
  });

  it('lê um CSV grande do disco linha a linha, com progresso', async () => {
    const path = join(dir, 'grande.csv');
    const lines = ['id;x;y'];
    for (let i = 1; i <= 50_000; i++) lines.push(`${i};${500000 + i},5;9580000`);
    writeFileSync(path, lines.join('\r\n'), 'latin1');
    const src = await openRows(path, 'grande.csv');
    const rows = await all(src);
    expect(rows).toHaveLength(50_001);
    expect(rows[0]).toEqual(['id', 'x', 'y']);
    expect(rows[50_000]).toEqual(['50000', '550000,5', '9580000']);
    expect(src.progress()).toBe(1);
  });

  it('XLSX: lê a aba escolhida em partes e para no meio sem travar', async () => {
    const path = join(dir, 'planilha.xlsx');
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Primeira').addRow(['a']).commit();
    const ws = wb.addWorksheet('Dados');
    ws.addRow(['id', 'nome', 'data']);
    for (let i = 1; i <= 3000; i++) ws.addRow([i, `ponto ${i}`, new Date(Date.UTC(2024, 0, 2))]);
    await wb.xlsx.writeFile(path);

    const src = await openRows(path, 'planilha.xlsx', 'Dados');
    expect(src.sheets).toEqual(['Primeira', 'Dados']);
    expect(src.sheet).toBe('Dados');
    const rows = await all(src);
    expect(rows).toHaveLength(3001);
    expect(rows[1]).toEqual([1, 'ponto 1', '2024-01-02']);

    const first = await openRows(path, 'planilha.xlsx');
    expect(first.sheet).toBe('Primeira');
    first.close();

    const partial = await openRows(path, 'planilha.xlsx', 'Dados');
    const head = [];
    for (let i = 0; i < 5; i++) head.push((await partial.rows.next()).value);
    partial.close();
    expect(head[4]).toEqual([4, 'ponto 4', '2024-01-02']);
  });
});
