import { BadRequestException } from '@nestjs/common';
import { CrsService } from '../modules/maps/crs.service';
import { buildFilterConditions, parseFilters } from './filters';
import { pointInPolygon } from './geo';
import { labelSql } from './label-expr';
import { ColumnMeta, Params, coordRange, qi } from './sql';

const col = (name: string, udtName: string, kind: ColumnMeta['kind']): ColumnMeta => ({
  name,
  udtName,
  formatType: udtName === 'varchar' ? 'character varying' : udtName,
  kind,
  nullable: true,
  hasDefault: false,
  isPrimaryKey: false,
  isIdentity: false,
  isGenerated: false,
  isNumeric: kind === 'integer' || kind === 'number',
  readOnly: false,
  position: 1,
});

describe('CrsService', () => {
  const crs = new CrsService();

  it('converte SIRGAS 2000 / UTM 24S para WGS84', () => {
    const h = crs.resolve('EPSG:31984');
    const ll = h.toLatLng(568649.8549, 9436907.676)!;
    expect(ll.lat).toBeCloseTo(-5.09404, 4);
    expect(ll.lng).toBeCloseTo(-38.38064, 4);
  });

  it('faz o caminho inverso (lat/lng -> UTM)', () => {
    const h = crs.resolve('EPSG:31984');
    const xy = h.toXY(-5.09404, -38.38064)!;
    expect(xy.x).toBeCloseTo(568650, -1);
    expect(xy.y).toBeCloseTo(9436907, -1);
  });

  it('rejeita coordenadas fora da faixa UTM', () => {
    const h = crs.resolve('EPSG:31983');
    expect(h.toLatLng(99_999_999, 7_000_000)).toBeNull();
    expect(h.isValid(500_000, 7_000_000)).toBe(true);
  });

  it('rejeita EPSG desconhecido e proj4 inválido', () => {
    expect(() => crs.resolve('EPSG:99999')).toThrow(BadRequestException);
    expect(() => crs.resolve('CUSTOM', '')).toThrow(BadRequestException);
  });

  it('aceita CRS personalizado', () => {
    const h = crs.resolve('CUSTOM', '+proj=utm +zone=23 +south +ellps=GRS80 +units=m +no_defs');
    expect(h.def.zone).toBe(23);
    expect(h.def.hemisphere).toBe('S');
  });
});

describe('filtros', () => {
  const cols = new Map([
    ['status', col('status', 'varchar', 'text')],
    ['potencia', col('potencia', 'int8', 'integer')],
  ]);

  it('gera SQL parametrizado (sem concatenar valores)', () => {
    const params = new Params();
    const conds = buildFilterConditions(
      parseFilters(JSON.stringify([
        { column: 'status', op: 'eq', value: "x'; DROP TABLE t; --" },
        { column: 'potencia', op: 'between', values: [10, 100] },
        { column: 'status', op: 'in', values: ['A', null] },
      ])),
      cols,
      params,
    );
    expect(conds.join(' ')).not.toContain('DROP TABLE');
    expect(params.values).toContain("x'; DROP TABLE t; --");
    expect(conds[0]).toBe('"status" = CAST($1 AS text)');
    expect(conds).toHaveLength(4);
  });

  it('rejeita colunas e operadores desconhecidos', () => {
    expect(() =>
      buildFilterConditions([{ column: 'nao_existe', op: 'eq', value: 1 }], cols, new Params()),
    ).toThrow(BadRequestException);
    expect(() => parseFilters('[{"column":"status","op":"drop"}]')).toThrow(BadRequestException);
    expect(() => parseFilters('nao-json')).toThrow(BadRequestException);
  });

  it('respeita "case sensitive" nos filtros de texto', () => {
    const params = new Params();
    const conds = buildFilterConditions(
      parseFilters([
        { column: 'status', op: 'eq', value: 'Ativo', caseSensitive: false },
        { column: 'status', op: 'contains', value: 'at', caseSensitive: true },
        { column: 'status', op: 'contains', value: 'at' },
        { column: 'potencia', op: 'eq', value: 10, caseSensitive: false },
      ]),
      cols,
      params,
    );
    expect(conds[0]).toBe('lower("status"::text) = lower($1)');
    expect(conds[1]).toBe('"status"::text LIKE $2');
    expect(conds[2]).toBe('"status"::text ILIKE $3');
    // Coluna numérica: "case sensitive" não se aplica.
    expect(conds[3]).toBe('"potencia" = CAST($4 AS int8)');
  });

  it('escapa identificadores', () => {
    expect(qi('a"b')).toBe('"a""b"');
  });

  it('arredonda limites de colunas inteiras', () => {
    const params = new Params();
    coordRange(col('x', 'int4', 'integer'), params, 10.4, 20.2);
    expect(params.values).toEqual(['10', '21']);
  });
});

describe('expressão de rótulo', () => {
  const cols = new Map([
    ['ID', col('ID', 'int8', 'integer')],
    ['tipo_lampada', col('tipo_lampada', 'varchar', 'text')],
    ['medicao', col('medicao', 'varchar', 'text')],
    ['geom', col('geom', 'geometry', 'geometry')],
  ]);

  it('converte a sintaxe do QGIS em concat parametrizado', () => {
    const params = new Params();
    const sql = labelSql(`"ID" || ' ' || "tipo_lampada" || ' ' || "medicao"`, cols, params);
    expect(sql).toBe('concat("ID"::text, CAST($1 AS text), "tipo_lampada"::text, CAST($2 AS text), "medicao"::text)');
    expect(params.values).toEqual([' ', ' ']);
  });

  it('aceita campo único, aspas escapadas e nomes sem aspas', () => {
    expect(labelSql('"ID"', cols, new Params())).toBe('"ID"::text');
    const params = new Params();
    labelSql(`medicao || 'it''s'`, cols, params);
    expect(params.values).toEqual(["it's"]);
    expect(labelSql('   ', cols, new Params())).toBeNull();
  });

  it('nunca injeta texto no SQL', () => {
    const params = new Params();
    const sql = labelSql(`"ID" || '); DROP TABLE t; --'`, cols, params)!;
    expect(sql).not.toContain('DROP');
  });

  it('rejeita campos desconhecidos, geometria e sintaxe inválida', () => {
    expect(() => labelSql('"nao_existe"', cols, new Params())).toThrow(BadRequestException);
    expect(() => labelSql('"geom"', cols, new Params())).toThrow(BadRequestException);
    expect(() => labelSql('"ID" "medicao"', cols, new Params())).toThrow(BadRequestException);
    expect(() => labelSql(`"ID" || 'aberto`, cols, new Params())).toThrow(BadRequestException);
    expect(() => labelSql('"ID"; DROP', cols, new Params())).toThrow(BadRequestException);
  });

  it('ignora || sobrando (início, fim, repetido)', () => {
    const params = new Params();
    expect(labelSql(`|| ' ' ||`, cols, params)).toBe('CAST($1 AS text)');
    expect(params.values).toEqual([' ']);
    expect(labelSql('"ID" ||', cols, new Params())).toBe('"ID"::text');
    expect(labelSql('"ID" || || "medicao"', cols, new Params())).toBe(
      'concat("ID"::text, "medicao"::text)',
    );
    expect(labelSql('||', cols, new Params())).toBeNull();
  });
});

describe('pointInPolygon', () => {
  const square = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 10 },
    { lat: 10, lng: 10 },
    { lat: 10, lng: 0 },
  ];
  it('detecta pontos dentro e fora', () => {
    expect(pointInPolygon({ lat: 5, lng: 5 }, square)).toBe(true);
    expect(pointInPolygon({ lat: 15, lng: 5 }, square)).toBe(false);
  });
});
