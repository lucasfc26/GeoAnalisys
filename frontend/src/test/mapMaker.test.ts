import { describe, expect, it } from 'vitest';
import type { GeoCollection } from '@/lib/boundaries';
import {
  ALL,
  boundaryData,
  boundaryNameFields,
  boundaryValues,
  buildMapFiles,
  defaultMapLabel,
  hasNoAttributes,
  normalizeMedicao,
  pointsInside,
  statusDate,
  toMapPoints,
} from '@/lib/mapMaker';
import type { GeoJsonPoint } from '@/services/export';

const square = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
const limites: GeoCollection = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: square, properties: { area: 3, NOME: 'SR 12' } },
    { type: 'Feature', geometry: square, properties: { area: 5, NOME: 'SR 2' } },
  ],
};

const point = (lng: number, lat: number, props: Record<string, unknown>): GeoJsonPoint => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lng, lat] },
  properties: props,
});

describe('limites', () => {
  it('sugere o campo do nome e lista os valores em ordem natural', () => {
    expect(boundaryNameFields(limites)[0]).toBe('NOME');
    expect(boundaryValues(limites, 'NOME')).toEqual(['SR 2', 'SR 12']);
  });

  it('"Todos" usa o arquivo inteiro; um nome usa só o polígono', () => {
    expect(boundaryData(limites, 'NOME', ALL)).toBe(limites);
    expect(boundaryData(limites, 'NOME', 'SR 12')).toBe(limites.features[0]);
  });

  it('nome dos arquivos: o polígono escolhido ou, com "Todos", o nome do limite', () => {
    expect(defaultMapLabel('Fortaleza SR 12', ALL)).toBe('Fortaleza SR 12');
    expect(defaultMapLabel('Fortaleza', 'SR 12')).toBe('SR 12');
    expect(defaultMapLabel(undefined, ALL)).toBe('');
  });

  it('detecta limite sem atributos (.shp sem .dbf)', () => {
    expect(hasNoAttributes(limites)).toBe(false);
    expect(
      hasNoAttributes({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: square, properties: {} }],
      }),
    ).toBe(true);
  });

  it('pontos dentro da região: respeita furos e multipolígonos', () => {
    const box = (a: number, b: number) => [[a, a], [b, a], [b, b], [a, b], [a, a]];
    const pts = toMapPoints(
      [point(1, 1, {}), point(5, 5, {}), point(11, 11, {}), point(20, 20, {})],
      {},
    );
    const comFuro = {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'Polygon', coordinates: [box(0, 10), box(4, 6)] },
    };
    expect(pointsInside(pts, comFuro).features.map((f) => f.geometry.coordinates)).toEqual([[1, 1]]);
    const multi = {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'MultiPolygon', coordinates: [[box(0, 2)], [box(10, 12)]] },
    };
    expect(pointsInside(pts, multi).features.map((f) => f.geometry.coordinates)).toEqual([
      [1, 1],
      [11, 11],
    ]);
  });
});

describe('pontos', () => {
  it('normaliza medição com ou sem acento', () => {
    expect(['Não', 'nao', ' NÃO ', 'Sim', 'SIM', 'outro', null].map(normalizeMedicao)).toEqual([
      'NAO',
      'NAO',
      'NAO',
      'SIM',
      'SIM',
      'outro',
      null,
    ]);
  });

  it('mantém só as propriedades do mapa e descarta pontos sem coordenada', () => {
    const fc = toMapPoints(
      [
        point(-38.5, -3.7, { MEDICAO: 'Não', potencia: 100, outra: 1 }),
        { type: 'Feature', geometry: null, properties: {} },
      ],
      { medicao: 'MEDICAO', potencia: 'potencia' },
    );
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties).toEqual({ medicao: 'NAO', potencia: 100 });
  });
});

describe('arquivos', () => {
  it('data do Status 18 é o último dia do mês anterior', () => {
    expect(statusDate(new Date(2026, 9, 6))).toBe('30-09-2026');
    expect(statusDate(new Date(2026, 0, 27))).toBe('31-12-2025');
  });

  const atual = toMapPoints(
    [point(-38.4, -3.8, { medicao: 'SIM' }), point(-38.5, -3.9, { medicao: 'Não' })],
    { medicao: 'medicao' },
  );
  const anterior = toMapPoints([point(-38.6, -3.7, { medicao: 'NAO' })], { medicao: 'medicao' });

  it('Comitê gera o mapa completo e o de estimados, centrado no primeiro ponto atual', () => {
    const files = buildMapFiles({
      kind: 'comite',
      label: 'Fortaleza SR 12',
      limite: limites.features[0],
      atual,
      anterior,
      token: 'pk.teste',
      fallbackCenter: [0, 0],
    });
    expect(files.map((f) => f.name)).toEqual([
      'Fortaleza SR 12 Comitê.html',
      'Fortaleza SR 12 estimados - Comitê.html',
    ]);
    expect(files.map((f) => f.points)).toEqual([3, 2]);
    expect(files[0].html).toContain('center: [-38.4,-3.8]');
    expect(files[0].html).toContain('"Point_Pontos anterior"');
    expect(files[0].html).toContain('"#ff0000"');
    expect(files[1].html).toContain('"Point_Pontos estimados"');
  });

  it('Status 18 gera só o censo atual', () => {
    const [file, ...rest] = buildMapFiles({
      kind: 'status18',
      label: 'Aquiraz',
      limite: limites,
      atual,
      token: 'pk.teste',
      fallbackCenter: [0, 0],
      today: new Date(2026, 6, 15),
    });
    expect(rest).toHaveLength(0);
    expect(file.name).toBe('Mapa cartográfico Censo de IP Aquiraz - 30-06-2026.html');
    expect(file.points).toBe(2);
    expect(file.html).not.toContain('anterior');
  });

  it('dados com "</script>" não fecham a tag do HTML', () => {
    const [file] = buildMapFiles({
      kind: 'status18',
      label: 'x',
      limite: limites,
      atual: toMapPoints([point(0, 0, { nome_cidade: '</script><b>' })], { nome_cidade: 'nome_cidade' }),
      token: 'pk',
      fallbackCenter: [0, 0],
    });
    expect(file.html.match(/<\/script>/g)).toHaveLength(2);
  });
});
