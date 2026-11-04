import {
  fileUrlOf,
  isImageFile,
  localFileEmbedUrl,
  localFilePath,
  previewUrl,
  templateColumns,
} from '@/lib/listPreview';

const data = {
  ID: 782777,
  link_relatorio: 'https://rel.exemplo.com/782777.pdf',
  tipo_lampada: 'LD',
  vazio: null,
};

describe('preview do modo lista', () => {
  it('usa o link do atributo escolhido', () => {
    expect(previewUrl({ mode: 'column', column: 'link_relatorio', template: '' }, data)).toEqual({
      url: 'https://rel.exemplo.com/782777.pdf',
    });
  });

  it('atributo vazio ou não escolhido explica o motivo', () => {
    expect(previewUrl({ mode: 'column', column: 'vazio', template: '' }, data)).toHaveProperty(
      'error',
    );
    expect(previewUrl({ mode: 'column', column: '', template: '' }, data)).toHaveProperty('error');
  });

  it('monta o link do modelo com os valores (nomes sem diferenciar maiúsculas)', () => {
    expect(
      previewUrl(
        { mode: 'template', column: '', template: 'https://site.com/r?id={id}&t={tipo_lampada}' },
        data,
      ),
    ).toEqual({ url: 'https://site.com/r?id=782777&t=LD' });
  });

  it('sem protocolo, assume https', () => {
    expect(previewUrl({ mode: 'template', column: '', template: 'site.com/{ID}' }, data)).toEqual({
      url: 'https://site.com/782777',
    });
  });

  it('atributo inexistente no modelo é avisado', () => {
    const r = previewUrl(
      { mode: 'template', column: '', template: 'https://s.com/{nao_existe}' },
      data,
    );
    expect(r).toEqual({ error: 'Atributo inexistente no link: nao_existe.' });
  });

  it('Street View usa a coordenada do ponto', () => {
    const cfg = { mode: 'streetview', column: '', template: '' } as const;
    expect(previewUrl(cfg, data, { lat: -23.5, lng: -46.6 })).toEqual({
      url: 'https://maps.google.com/maps?layer=c&cbll=-23.5,-46.6&cbp=11,0,0,0,0&output=svembed',
      external: 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=-23.5,-46.6',
    });
    expect(previewUrl(cfg, data, { lat: null, lng: null })).toEqual({
      error: 'O ponto não tem coordenadas.',
    });
  });

  it('reconhece arquivo local (file:/// e caminho do Windows) para o preview', () => {
    const link =
      'file:///C:/Users/lfrotacu/OneDrive%20-%20NTT%20DATA%20EMEAL/Im%C3%A1genes/Capturas%20de%20pantalla/Captura%20de%20tela%202026-10-05%20103843.png';
    const path = localFilePath(link);
    expect(path).toBe(
      'C:/Users/lfrotacu/OneDrive - NTT DATA EMEAL/Imágenes/Capturas de pantalla/Captura de tela 2026-10-05 103843.png',
    );
    expect(isImageFile(path!)).toBe(true);
    expect(localFileEmbedUrl(path!)).toBe(
      'local-file://local/C%3A/Users/lfrotacu/OneDrive%20-%20NTT%20DATA%20EMEAL/Im%C3%A1genes/Capturas%20de%20pantalla/Captura%20de%20tela%202026-10-05%20103843.png',
    );
    expect(fileUrlOf(path!)).toBe(
      'file:///C%3A/Users/lfrotacu/OneDrive%20-%20NTT%20DATA%20EMEAL/Im%C3%A1genes/Capturas%20de%20pantalla/Captura%20de%20tela%202026-10-05%20103843.png',
    );
    expect(previewUrl({ mode: 'column', column: 'foto', template: '' }, { foto: link })).toEqual({
      url: link,
    });
    const win = String.raw`C:\Fotos\lampada.png`;
    expect(localFilePath(win)).toBe(win);
    expect(previewUrl({ mode: 'column', column: 'foto', template: '' }, { foto: win })).toEqual({
      url: win,
    });
  });

  it('lista os atributos citados no modelo', () => {
    expect(templateColumns('https://s.com/{ID}/{ tipo }')).toEqual(['ID', 'tipo']);
  });
});
