import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { IsIn, IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';

const TOOLS = ['association', 'duplicates', 'attribute-distance', 'comparison'] as const;
type Tool = (typeof TOOLS)[number];

class CreateToolTemplateDto {
  @IsIn(TOOLS) tool: Tool;
  @IsString()
  @MaxLength(100)
  @Matches(/\S/, { message: 'Informe o nome do template' })
  name: string;
  @IsObject() settings: Record<string, unknown>;
}

class UpdateToolTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/\S/, { message: 'Informe o nome do template' })
  name?: string;
  @IsOptional() @IsObject() settings?: Record<string, unknown>;
}

/** Templates das configurações das ferramentas (gis_app.tool_template), por ferramenta. */
@ApiTags('tool-templates')
@Controller('tool-templates')
class ToolTemplatesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Templates de configuração de uma ferramenta' })
  list(@Query('tool') tool: string) {
    return this.prisma.toolTemplate.findMany({
      where: { tool: TOOLS.includes(tool as Tool) ? tool : '' },
      orderBy: { name: 'asc' },
    });
  }

  @Post()
  create(@Body() dto: CreateToolTemplateDto) {
    const name = dto.name.trim();
    return this.unique(name, () =>
      this.prisma.toolTemplate.create({
        data: { tool: dto.tool, name, settings: dto.settings as Prisma.InputJsonObject },
      }),
    );
  }

  @Patch(':id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateToolTemplateDto) {
    const current = await this.prisma.toolTemplate.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Template não encontrado');
    const name = dto.name?.trim() ?? current.name;
    return this.unique(name, () =>
      this.prisma.toolTemplate.update({
        where: { id },
        data: {
          name,
          ...(dto.settings ? { settings: dto.settings as Prisma.InputJsonObject } : {}),
        },
      }),
    );
  }

  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const { count } = await this.prisma.toolTemplate.deleteMany({ where: { id } });
    if (!count) throw new NotFoundException('Template não encontrado');
    return { deleted: true };
  }

  private async unique<T>(name: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`Já existe um template chamado "${name}" nesta ferramenta`);
      }
      throw err;
    }
  }
}

@Module({ controllers: [ToolTemplatesController] })
export class ToolTemplatesModule {}
