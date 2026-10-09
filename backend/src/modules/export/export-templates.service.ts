import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SourcesService } from '../tables/sources.service';
import { pickFields } from './export.service';

export interface TemplateInput {
  sourceId: string;
  name: string;
  columns: string[];
}

/** Modelos de exportação (colunas e ordem) salvos por fonte de dados em gis_app.export_template. */
@Injectable()
export class ExportTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: SourcesService,
  ) {}

  list(sourceId: string) {
    return this.prisma.exportTemplate.findMany({ where: { sourceId }, orderBy: { name: 'asc' } });
  }

  async create(input: TemplateInput) {
    const columns = await this.validColumns(input.sourceId, input.columns);
    return this.unique(input.name, () =>
      this.prisma.exportTemplate.create({
        data: { sourceId: input.sourceId, name: input.name.trim(), columns },
      }),
    );
  }

  async update(id: string, patch: Partial<Pick<TemplateInput, 'name' | 'columns'>>) {
    const current = await this.prisma.exportTemplate.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Modelo de exportação não encontrado');
    const data: Prisma.ExportTemplateUpdateInput = {};
    if (patch.name !== undefined) data.name = patch.name.trim();
    if (patch.columns !== undefined) {
      data.columns = await this.validColumns(current.sourceId, patch.columns);
    }
    return this.unique(patch.name ?? current.name, () =>
      this.prisma.exportTemplate.update({ where: { id }, data }),
    );
  }

  async remove(id: string) {
    const { count } = await this.prisma.exportTemplate.deleteMany({ where: { id } });
    if (!count) throw new NotFoundException('Modelo de exportação não encontrado');
    return { deleted: true };
  }

  /** Só colunas que existem na tabela (ou latitude/longitude calculadas), sem repetição. */
  private async validColumns(sourceId: string, columns: string[]) {
    const ctx = await this.sources.context(sourceId, true);
    return pickFields(ctx, columns).map((f) => f.key);
  }

  private async unique<T>(name: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`Já existe um modelo chamado "${name.trim()}" para esta tabela`);
      }
      throw err;
    }
  }
}
