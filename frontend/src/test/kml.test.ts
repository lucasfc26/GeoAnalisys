import { describe, expect, it } from 'vitest';
import { readBoundaryFiles } from '@/lib/boundaries';
import { kmlFileToGeoJson, kmlToGeoJson } from '@/lib/kml';

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
  <Document>
    <name>Doc</name>
    <Folder>
      <name>Postes</name>
      <Placemark>
        <name>P1</name>
        <description><![CDATA[<b>Poste</b> & cia]]></description>
        <ExtendedData>
          <Data name="altura"><value>9</value></Data>
          <SchemaData schemaUrl="#s"><SimpleData name="tipo">ME</SimpleData></SchemaData>
        </ExtendedData>
        <Point><coordinates>-38.5,-3.7,0</coordinates></Point>
      </Placemark>
    </Folder>
    <Placemark>
      <name>Área</name>
      <Polygon>
        <outerBoundaryIs><LinearRing><coordinates>
          -38.5,-3.7 -38.4,-3.7 -38.4,-3.6
        </coordinates></LinearRing></outerBoundaryIs>
        <innerBoundaryIs><LinearRing><coordinates>
          -38.46,-3.66 -38.44,-3.66 -38.44,-3.64 -38.46,-3.66
        </coordinates></LinearRing></innerBoundaryIs>
      </Polygon>
    </Placemark>
    <Placemark>
      <MultiGeometry>
        <LineString><coordinates>0,0 1,1</coordinates></LineString>
        <LineString><coordinates>2,2 3,3</coordinates></LineString>
      </MultiGeometry>
    </Placemark>
    <Placemark>
      <gx:Track><gx:coord>1 2 0</gx:coord><gx:coord>3 4 0</gx:coord></gx:Track>
    </Placemark>
  </Document>
</kml>`;

describe('kmlToGeoJson', () => {
  it('converte marcadores, atributos, pastas e geometrias', () => {
    const fc = kmlToGeoJson(KML);
    expect(fc.features).toHaveLength(4);
    const [p, area, multi, track] = fc.features;
    expect(p.properties).toEqual({
      name: 'P1',
      description: '<b>Poste</b> & cia',
      pasta: 'Postes',
      altura: '9',
      tipo: 'ME',
    });
    expect(p.geometry).toEqual({ type: 'Point', coordinates: [-38.5, -3.7] });
    expect(area.properties).toEqual({ name: 'Área' });
    const rings = area.geometry!.coordinates as number[][][];
    expect(rings).toHaveLength(2);
    expect(rings[0]).toHaveLength(4); // anel fechado automaticamente
    expect(rings[0][3]).toEqual([-38.5, -3.7]);
    expect(multi.geometry).toEqual({
      type: 'MultiLineString',
      coordinates: [
        [[0, 0], [1, 1]],
        [[2, 2], [3, 3]],
      ],
    });
    expect(track.geometry).toEqual({ type: 'LineString', coordinates: [[1, 2], [3, 4]] });
  });

  it('erros: XML inválido, não-KML e sem marcadores', () => {
    expect(() => kmlToGeoJson('<kml><Document>')).toThrow(/KML inválido/);
    expect(() => kmlToGeoJson('<gpx></gpx>')).toThrow(/KML inválido/);
    expect(() => kmlToGeoJson('<kml><Document/></kml>')).toThrow(/Placemark/);
  });

  it('arquivo .kml vira .geojson e é aceito como limite', async () => {
    const f = new File([KML], 'rede.kml');
    const gj = await kmlFileToGeoJson(f);
    expect(gj.name).toBe('rede.geojson');
    expect(JSON.parse(await gj.text()).features).toHaveLength(4);
    const [b] = await readBoundaryFiles([f], null);
    expect(b.name).toBe('rede');
    expect(b.data.features).toHaveLength(4);
    expect(b.bounds!.minLng).toBe(-38.5);
  });
});
