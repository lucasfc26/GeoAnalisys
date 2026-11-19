import { BadRequestException } from '@nestjs/common';
import type { ColumnMeta } from '../../common/sql';
import { buildAppendPlan } from './append.plan';

const col = (patch: Partial<ColumnMeta> & Pick<ColumnMeta, 'name'>): ColumnMeta => ({
  formatType: 'text',
  udtName: 'text',
  kind: 'text',
  nullable: true,
  hasDefault: false,
  isPrimaryKey: false,
  isIdentity: false,
  isGenerated: false,
  isNumeric: false,
  readOnly: false,
  position: 1,
  ...patch,
});

describe('associação de colunas para importar na tabela', () => {
  const columns = [
    col({ name: 'id', kind: 'integer', isNumeric: true, nullable: false, hasDefault: true, isPrimaryKey: true }),
    col({ name: 'nome', nullable: false }),
    col({ name: 'obs' }),
    col({ name: 'geom', kind: 'geometry', readOnly: true }),
  ];

  it('liga a coluna da tabela à do arquivo e ignora associação em branco', () => {
    const plan = buildAppendPlan(columns, ['Nome', 'Observacao'], {
      nome: 'Nome',
      obs: '',
    });
    expect(plan.columns.map((c) => c.name)).toEqual(['nome']);
    expect(plan.indexes).toEqual([0]);
  });

  it('não grava em coluna somente leitura (geometria)', () => {
    expect(() => buildAppendPlan(columns, ['Nome'], { geom: 'Nome', nome: 'Nome' })).toThrow(
      /não existe na tabela/,
    );
  });

  it('exige coluna obrigatória sem valor padrão', () => {
    expect(() => buildAppendPlan(columns, ['Nome'], { obs: 'Nome' })).toThrow(BadRequestException);
  });

  it('recusa coluna desconhecida e arquivo sem a coluna citada', () => {
    expect(() => buildAppendPlan(columns, ['Nome'], { fantasma: 'Nome', nome: 'Nome' })).toThrow(
      /não existe na tabela/,
    );
    expect(() => buildAppendPlan(columns, ['Nome'], { nome: 'Outra' })).toThrow(/não existe no arquivo/);
  });

  it('pede pelo menos uma associação', () => {
    expect(() => buildAppendPlan(columns, ['Nome'], {})).toThrow(/pelo menos uma coluna/);
  });
});
