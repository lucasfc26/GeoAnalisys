import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OUTLINE_WIDTH,
  addLabelTemplate,
  labelBufferColor,
  labelBufferWidth,
  labelCanvasFont,
  newLayer,
  pointOutline,
  pointOutlineWidth,
  removeLabelTemplate,
  renameLabelTemplate,
  resolveLayer,
  switchLabelTemplate,
  syncLabelTemplate,
} from '@/lib/layers';
import type { DataSource } from '@/types';

describe('templates de rótulo', () => {
  it('cria, edita, alterna, renomeia e exclui', () => {
    let l = newLayer('s1', 0);
    l = { ...l, label: { ...l.label, enabled: true, expression: '"ID"' } };
    l = addLabelTemplate(l, 'Só ID');
    const a = l.activeLabelTemplate!;
    expect(l.labelTemplates).toHaveLength(1);

    // Novo template a partir do atual, depois editado.
    l = addLabelTemplate(l, '  ');
    const b = l.activeLabelTemplate!;
    expect(l.labelTemplates![1].name).toBe('Template');
    l = { ...l, label: { ...l.label, expression: '"medicao"', color: '#ff0000' } };

    // Trocar salva a edição no template ativo e carrega o outro.
    l = switchLabelTemplate(l, a);
    expect(l.label.expression).toBe('"ID"');
    expect(l.labelTemplates!.find((t) => t.id === b)!.label.expression).toBe('"medicao"');
    l = switchLabelTemplate(l, b);
    expect(l.label).toMatchObject({ expression: '"medicao"', color: '#ff0000' });

    // Edição sem trocar: sync grava no ativo.
    l = syncLabelTemplate({ ...l, label: { ...l.label, size: 20 } });
    expect(l.labelTemplates!.find((t) => t.id === b)!.label.size).toBe(20);

    l = renameLabelTemplate(l, b, 'Medição');
    expect(l.labelTemplates!.map((t) => t.name)).toEqual(['Só ID', 'Medição']);
    expect(renameLabelTemplate(l, b, ' ')).toBe(l);

    l = removeLabelTemplate(l, b);
    expect(l.activeLabelTemplate).toBeNull();
    expect(l.label.expression).toBe('"medicao"'); // rótulo em uso continua
    expect(l.labelTemplates).toHaveLength(1);
  });

  it('contorno dos pontos: padrão preto 0,3 px, cor própria ou desligado', () => {
    const l = newLayer('s1', 0);
    expect(pointOutline(l)).toBe('#000000');
    expect(pointOutline({ ...l, outlineColor: '#ffffff' })).toBe('#ffffff');
    expect(pointOutline({ ...l, outline: false, outlineColor: '#ffffff' })).toBeNull();
    expect(pointOutlineWidth(l)).toBe(DEFAULT_OUTLINE_WIDTH);
    expect(DEFAULT_OUTLINE_WIDTH).toBe(0.3);
    expect(pointOutlineWidth({ ...l, outlineWidth: 2 })).toBe(2);
  });

  it('rótulos: contorno preto 0,3 px por padrão; expressão vazia = sem rótulo', () => {
    const l = newLayer('s1', 0);
    expect(labelBufferColor(l.label)).toBe('#000000');
    expect(labelBufferWidth(l.label)).toBe(0.3);
    expect(labelCanvasFont({ ...l.label, italic: true, font: 'Georgia' })).toBe(
      'italic bold 11px Georgia, "Times New Roman", serif',
    );
    const on = { ...l, label: { ...l.label, enabled: true, expression: '  ' } };
    expect(resolveLayer(on, { labelColumn: 'nome', idColumn: 'ID' } as DataSource).label).toBe('');
  });
});
