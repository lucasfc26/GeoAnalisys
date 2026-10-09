import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';

class ProjectDto {
  @ApiProperty({ description: 'Nome do projeto (nome do arquivo .proj, sem a extensão)' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({
    description:
      'true = projeto salvo (atualiza updated_at); false = só aberto (registra se faltar)',
  })
  @IsOptional()
  @IsBoolean()
  touch?: boolean;
}

/** Projetos (gis_app.projetos). O conteúdo fica no arquivo .proj; aqui só id, nome e datas. */
@ApiTags('projects')
@Controller('projects')
class ProjectsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Projetos registrados neste banco' })
  list() {
    return this.prisma.project.findMany({ orderBy: { updatedAt: 'desc' } });
  }

  @Put(':id')
  @ApiOperation({
    summary:
      'Registra o projeto (ao criar/abrir) ou atualiza nome e data de atualização (ao salvar)',
  })
  async save(@Param('id', new ParseUUIDPipe()) rawId: string, @Body() dto: ProjectDto) {
    const id = rawId.toLowerCase();
    const name = dto.name.trim();
    if (!dto.touch) {
      // Só abrindo: mantém a data de atualização (exceto se o arquivo foi renomeado).
      const existing = await this.prisma.project.findUnique({ where: { id } });
      if (existing?.name === name) return existing;
    }
    return this.prisma.project.upsert({
      where: { id },
      create: { id, name },
      update: { name },
    });
  }
}

@Module({ controllers: [ProjectsController] })
export class ProjectsModule {}
