import { BadRequestException } from '@nestjs/common';
import type { ColumnMeta } from '../../common/sql';
import type { SourceContext } from '../tables/sources.service';
import { LAT_KEY, LNG_KEY, cleanHeaders, exportFields, pickFields } from './export.service';

const col = (name: string, kind: ColumnMeta['kind'] = 'text') => ({ name, kind }) as ColumnMeta;

const columns = [
  col('ID', 'integer'),
  col('medicao'),
  col('latitude', 'number'),
  col('longitude', 'number'),
  col('potencia', 'integer'),
];
const ctx = {
  columns,
  idCol: columns[0],
  xCol: columns[2],
  yCol: columns[3],
  crs: { def: { kind: 'utm' } },
} as unknown as SourceContext;

const row = {
  id: 7,
  x: 568649,
  y: 9436907,
  lat: -3.7,
  lng: -38.5,
  data: { medicao: 'SIM', potencia: 100 },
};

describe('campos da exportação', () => {
  it('ordem padrão: ID, X, Y, latitude, longitude e as demais colunas', () => {
    expect(exportFields(ctx).map((f) => f.header)).toEqual([
      'ID',
      'UTMX',
      'UTMY',
      'Latitude',
      'Longitude',
      'medicao',
      'potencia',
    ]);
  });

  it('usa as colunas escolhidas na ordem pedida, sem repetir', () => {
    const fields = pickFields(ctx, ['potencia', LAT_KEY, 'ID', 'potencia', 'latitude']);
    expect(fields.map((f) => f.header)).toEqual(['potencia', 'Latitude', 'ID', 'UTMX']);
    expect(fields.map((f) => f.value(row))).toEqual([100, -3.7, 7, 568649]);
  });

  it('sem lista exporta tudo', () => {
    expect(pickFields(ctx).map((f) => f.key)).toEqual(exportFields(ctx).map((f) => f.key));
    expect(pickFields(ctx).map((f) => f.key)).toContain(LNG_KEY);
  });

  it('rejeita coluna desconhecida ou lista vazia', () => {
    expect(() => pickFields(ctx, ['nao_existe'])).toThrow(BadRequestException);
    expect(() => pickFields(ctx, [])).toThrow(BadRequestException);
  });

  it('usa os nomes alternativos no cabeçalho', () => {
    const fields = pickFields(ctx, ['ID', 'potencia', LAT_KEY], { ID: 'idd', [LAT_KEY]: 'lat' });
    expect(fields.map((f) => f.header)).toEqual(['idd', 'potencia', 'lat']);
    expect(pickFields(ctx, undefined, { medicao: 'Medição' }).map((f) => f.header)).toContain(
      'Medição',
    );
  });

  it('rejeita nome alternativo repetido no arquivo', () => {
    expect(() => pickFields(ctx, ['ID', 'potencia'], { ID: 'Potencia' })).toThrow(
      BadRequestException,
    );
    expect(() => pickFields(ctx, ['ID', 'potencia'], { ID: 'x', potencia: 'X' })).toThrow(
      BadRequestException,
    );
  });
});

describe('nomes alternativos', () => {
  it('descarta vazios e tira espaços', () => {
    expect(cleanHeaders({ ID: ' idd ', medicao: '  ' })).toEqual({ ID: 'idd' });
    expect(cleanHeaders({ ID: '' })).toBeUndefined();
    expect(cleanHeaders(undefined)).toBeUndefined();
  });

  it('rejeita formatos inválidos', () => {
    expect(() => cleanHeaders(['idd'])).toThrow(BadRequestException);
    expect(() => cleanHeaders({ ID: 1 })).toThrow(BadRequestException);
    expect(() => cleanHeaders({ ID: 'a'.repeat(101) })).toThrow(BadRequestException);
  });
});
