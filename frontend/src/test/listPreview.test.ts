import { previewUrl, templateColumns } from '@/lib/listPreview';

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

  it('lista os atributos citados no modelo', () => {
    expect(templateColumns('https://s.com/{ID}/{ tipo }')).toEqual(['ID', 'tipo']);
  });
});
