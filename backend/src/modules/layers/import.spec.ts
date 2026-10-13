import ExcelJS from 'exceljs';
import {
  cellValue,
  columnNamesFrom,
  convert,
  decodeText,
  detectDelimiter,
  freeName,
  geoJsonToSheet,
  inferTypes,
  parseCsv,
  readCoordinates,
  readWorkbook,
  representativePoint,
  sheetRows,
  suggestColumns,
  tableNameFrom,
  tableValue,
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
      coordColumn: null,
      coordinates: 'projected',
    });
  });

  it('reconhece GMS, vírgula decimal longa e coluna com o par', () => {
    const dms = toSheet([
      ['nome', 'lat', 'lon'],
      ['p1', `3º 50' 37,926" S`, `38º 24' 14,8" W`],
      ['p2', `3º 51' 00" S`, `38º 25' 00" W`],
    ]);
    expect(suggestColumns(dms, inferTypes(dms))).toMatchObject({
      xColumn: 'lon',
      yColumn: 'lat',
      coordinates: 'geographic',
    });
    const xy = readCoordinates(dms, { xColumn: 'lon', yColumn: 'lat' }, true);
    expect(xy[0]!.y).toBeCloseTo(-3.843868, 5);
    expect(xy[0]!.x).toBeCloseTo(-38.404111, 5);

    // Sem nomes reconhecíveis: hemisférios dizem quem é latitude e quem é longitude.
    const hemi = toSheet([
      ['a', 'b'],
      [`38°24'14.8"W`, `3°50'37.9"S`],
    ]);
    expect(suggestColumns(hemi, inferTypes(hemi))).toMatchObject({ xColumn: 'a', yColumn: 'b' });

    const long = toSheet([
      ['latitude', 'longitude'],
      ['-3,84386839999999123', '-38,4041111000000012'],
    ]);
    expect(suggestColumns(long, inferTypes(long))).toMatchObject({
      xColumn: 'longitude',
      coordinates: 'geographic',
    });

    const pair = toSheet([
      ['nome', 'Coordenadas'],
      ['p1', '-3,84386839999999, -38,4041111'],
      ['p2', '-3,85, -38,41'],
    ]);
    expect(suggestColumns(pair, inferTypes(pair))).toMatchObject({
      xColumn: null,
      yColumn: null,
      coordColumn: 'Coordenadas',
      coordinates: 'geographic',
    });
    expect(readCoordinates(pair, { coordColumn: 'Coordenadas' }, true)[0]).toEqual({
      x: -38.4041111,
      y: -3.84386839999999,
    });

    const utmPair = toSheet([['ponto'], ['566160,537294959 9575107,59118882']]);
    expect(suggestColumns(utmPair, inferTypes(utmPair))).toMatchObject({
      coordColumn: 'ponto',
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
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-38.5, -3.7, 10] },
          properties: { nome: 'A', longitude: 1 },
        },
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [2, 0],
                [2, 2],
                [0, 2],
                [0, 0],
              ],
            ],
          },
          properties: { nome: 'B', extra: { a: 1 } },
        },
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [4, 0],
            ],
          },
          properties: null,
        },
        { type: 'Feature', geometry: null, properties: { nome: 'D' } },
      ],
    };
    const { sheet, xColumn, yColumn } = geoJsonToSheet(JSON.stringify(fc));
    expect(sheet.headers).toEqual([
      'nome',
      'longitude',
      'extra',
      'longitude_2',
      'latitude',
      'tipo_geometria',
    ]);
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
    const big = [
      [
        [10, 10],
        [20, 10],
        [20, 20],
        [10, 20],
        [10, 10],
      ],
    ];
    const small = [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
    ];
    expect(representativePoint({ type: 'MultiPolygon', coordinates: [small, big] })).toEqual([
      15, 15,
    ]);
    expect(
      representativePoint({
        type: 'MultiLineString',
        coordinates: [
          [
            [0, 0],
            [1, 0],
          ],
          [
            [0, 5],
            [0, 15],
          ],
        ],
      }),
    ).toEqual([0, 10]);
    expect(
      representativePoint({
        type: 'MultiPoint',
        coordinates: [
          [0, 0],
          [2, 4],
        ],
      }),
    ).toEqual([1, 2]);
  });

  it('nome de tabela seguro', () => {
    expect(tableNameFrom('Censo Atual — Revisão 2')).toBe('censo_atual_revisao_2');
    expect(tableNameFrom('2024 pontos')).toBe('camada_2024_pontos');
    expect(tableNameFrom('***')).toBe('camada');
  });

  it('colunas de um resultado: sem vazios/repetidos e até 60 bytes', () => {
    const long = 'Potência da lâmpada instalada no ponto de iluminação Censo Atual';
    const names = columnNamesFrom(['ID Censo', '  Status  ', '', 'status', long]);
    expect(names.slice(0, 4)).toEqual(['ID Censo', 'Status', 'coluna_3', 'status_2']);
    expect(Buffer.byteLength(names[4])).toBeLessThanOrEqual(60);
    expect(long.startsWith(names[4])).toBe(true);

    const taken = new Set(names.map((n) => n.toLowerCase()));
    expect(freeName('id', taken)).toBe('id');
    expect(freeName('id', taken)).toBe('id_2');
    expect(freeName('STATUS', taken)).toBe('STATUS_3');
  });

  it('valores do banco convertidos para o tipo da coluna', () => {
    expect(tableValue('9007199254740993', 'integer')).toEqual({
      value: '9007199254740993',
      invalid: false,
    });
    expect(tableValue(12.5, 'integer')).toEqual({ value: null, invalid: true });
    expect(tableValue(12.5, 'number')).toEqual({ value: 12.5, invalid: false });
    expect(tableValue(BigInt(7), 'integer')).toEqual({ value: '7', invalid: false });
    expect(tableValue(true, 'text')).toEqual({ value: 'true', invalid: false });
    expect(tableValue({ a: 1 }, 'text')).toEqual({ value: '{"a":1}', invalid: false });
    expect(tableValue(undefined, 'number')).toEqual({ value: null, invalid: false });
  });
});
