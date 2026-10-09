import ExcelJS from 'exceljs';
import {
  cellValue,
  convert,
  decodeText,
  detectDelimiter,
  geoJsonToSheet,
  inferTypes,
  parseCsv,
  readWorkbook,
  representativePoint,
  sheetRows,
  suggestColumns,
  tableNameFrom,
  toNumber,
  toSheet,
} from './import.parse';

describe('importação de planilhas', () => {
  it('CSV: delimitador, aspas, quebras de linha e BOM', () => {
    const text = decodeText(
      Buffer.from(
        '﻿ID;endereco;utm_x\n1;"Rua A; nº 2";412343,32\r\n2;"diz ""oi""\nlinha 2";9\n\n',
        'utf8',
      ),
    );
    expect(detectDelimiter(text)).toBe(';');
    expect(parseCsv(text)).toEqual([
      ['ID', 'endereco', 'utm_x'],
      ['1', 'Rua A; nº 2', '412343,32'],
      ['2', 'diz "oi"\nlinha 2', '9'],
    ]);
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t');
  });

  it('CSV salvo em ANSI (Windows-1252) é lido com acentos', () => {
    const ansi = Buffer.from([0x50, 0x6f, 0x74, 0xea, 0x6e, 0x63, 0x69, 0x61]); // "Potência" em 1252
    expect(decodeText(ansi)).toBe('Potência');
  });

  it('números com vírgula decimal e milhar; códigos continuam texto', () => {
    expect(toNumber('412343,32')).toBe(412343.32);
    expect(toNumber('9.741.270,2')).toBe(9741270.2);
    expect(toNumber('1,234.5')).toBe(1234.5);
    expect(toNumber('70')).toBe(70);
    expect(toNumber('0123')).toBeNull();
    expect(toNumber('ME')).toBeNull();
    expect(toNumber(15.5)).toBe(15.5);
  });

  it('cabeçalhos limpos, tipos inferidos e conversão', () => {
    const sheet = toSheet([
      ['ID', 'tipo', '', 'tipo', 'utm_x', 'utm_y'],
      [1, 'ME', 'a', 'x', '412343,32', 9741270.2],
      [2, 'VS', null, 'y', '412350', 9741280],
    ]);
    expect(sheet.headers).toEqual(['ID', 'tipo', 'coluna_3', 'tipo_2', 'utm_x', 'utm_y']);
    const types = inferTypes(sheet);
    expect(types).toEqual(['integer', 'text', 'text', 'text', 'number', 'number']);
    expect(convert('412343,32', 'number')).toEqual({ value: 412343.32, invalid: false });
    expect(convert('abc', 'integer')).toEqual({ value: null, invalid: true });
    expect(convert(null, 'integer')).toEqual({ value: null, invalid: false });
    expect(suggestColumns(sheet, types)).toEqual({
      idColumn: 'ID',
      xColumn: 'utm_x',
      yColumn: 'utm_y',
      coordinates: 'projected',
    });
  });

  it('sugere X/Y pelos valores (UTM) e reconhece lat/lng', () => {
    const utm = toSheet([
      ['a', 'b', 'c'],
      ['p1', 568649.85, 9436907.6],
      ['p2', 568700.1, 9436950.2],
    ]);
    expect(suggestColumns(utm, inferTypes(utm))).toMatchObject({
      xColumn: 'b',
      yColumn: 'c',
      coordinates: 'projected',
    });
    const geo = toSheet([
      ['nome', 'latitude', 'longitude'],
      ['p1', -3.7, -38.5],
    ]);
    expect(suggestColumns(geo, inferTypes(geo))).toMatchObject({
      xColumn: 'longitude',
      yColumn: 'latitude',
      coordinates: 'geographic',
    });
  });

  it('XLSX: abas, fórmulas, texto rico e datas', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Pontos');
    ws.addRow(['ID', 'nome', 'valor', 'data']);
    ws.addRow([
      1,
      { richText: [{ text: 'Rua ' }, { text: 'A' }] },
      { formula: '1+1', result: 2 },
      new Date(Date.UTC(2024, 0, 15)),
    ]);
    wb.addWorksheet('Outra').addRow(['x']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const read = await readWorkbook(buf);
    expect(read.worksheets.map((w) => w.name)).toEqual(['Pontos', 'Outra']);
    expect(sheetRows(read.getWorksheet('Pontos')!)).toEqual([
      ['ID', 'nome', 'valor', 'data'],
      [1, 'Rua A', 2, '2024-01-15'],
    ]);
    expect(cellValue({ error: '#N/A' })).toBeNull();
  });

  it('GeoJSON: uma linha por feição, propriedades + coordenadas', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [-38.5, -3.7, 10] }, properties: { nome: 'A', longitude: 1 } },
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] },
          properties: { nome: 'B', extra: { a: 1 } },
        },
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [4, 0]] }, properties: null },
        { type: 'Feature', geometry: null, properties: { nome: 'D' } },
      ],
    };
    const { sheet, xColumn, yColumn } = geoJsonToSheet(JSON.stringify(fc));
    expect(sheet.headers).toEqual(['nome', 'longitude', 'extra', 'longitude_2', 'latitude', 'tipo_geometria']);
    expect([xColumn, yColumn]).toEqual(['longitude_2', 'latitude']);
    expect(sheet.rows).toEqual([
      ['A', 1, null, -38.5, -3.7, 'Point'],
      ['B', null, '{"a":1}', 1, 1, 'Polygon'],
      [null, null, null, 2, 0, 'LineString'],
      ['D', null, null, null, null, null],
    ]);
    // Geometria solta (sem Feature) e só pontos: sem coluna de tipo.
    expect(geoJsonToSheet('{"type":"Point","coordinates":[1,2]}').sheet.headers).toEqual([
      'longitude',
      'latitude',
    ]);
    expect(() => geoJsonToSheet('{oops')).toThrow(/GeoJSON inválido/);
    expect(() => geoJsonToSheet('{"type":"FeatureCollection","features":[]}')).toThrow(/feições/);
  });

  it('ponto representativo: maior polígono e linha mais longa', () => {
    const big = [[[10, 10], [20, 10], [20, 20], [10, 20], [10, 10]]];
    const small = [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]];
    expect(representativePoint({ type: 'MultiPolygon', coordinates: [small, big] })).toEqual([15, 15]);
    expect(
      representativePoint({ type: 'MultiLineString', coordinates: [[[0, 0], [1, 0]], [[0, 5], [0, 15]]] }),
    ).toEqual([0, 10]);
    expect(representativePoint({ type: 'MultiPoint', coordinates: [[0, 0], [2, 4]] })).toEqual([1, 2]);
  });

  it('nome de tabela seguro', () => {
    expect(tableNameFrom('Censo Atual — Revisão 2')).toBe('censo_atual_revisao_2');
    expect(tableNameFrom('2024 pontos')).toBe('camada_2024_pontos');
    expect(tableNameFrom('***')).toBe('camada');
  });
});
