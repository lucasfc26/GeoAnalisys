import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import type { Response } from 'express';
import { parseFilters } from '../../common/filters';
import { MAX_IDS } from '../points/dto/points.dto';
import { ExportTemplatesService } from './export-templates.service';
import { ExportFormat, ExportService, cleanHeaders } from './export.service';

enum Format {
  csv = 'csv',
  xlsx = 'xlsx',
  json = 'json',
  kml = 'kml',
}

const MAX_COLUMNS = 2000;

/** `columns` na query string: lista JSON de nomes de coluna. */
function parseColumns(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new BadRequestException('columns deve ser uma lista JSON');
  }
  if (!Array.isArray(v) || v.length > MAX_COLUMNS || v.some((c) => typeof c !== 'string')) {
    throw new BadRequestException('columns deve ser uma lista de nomes de coluna');
  }
  return v as string[];
}

/** `headers` na query string: objeto JSON { coluna: nome no arquivo }. */
function parseHeaders(raw?: string): Record<string, string> | undefined {
  if (!raw) return undefined;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new BadRequestException('headers deve ser um objeto JSON');
  }
  return cleanHeaders(v);
}

class ExportQueryDto {
  @IsUUID() sourceId: string;
  @IsOptional() @IsIn(['all', 'filtered']) scope?: 'all' | 'filtered';
  @IsOptional() @IsString() filters?: string;
  @IsOptional() @IsIn([';', ',', 'tab', '|']) delimiter?: string;
  @IsOptional() @IsIn(['.', ',']) decimal?: '.' | ',';
  @IsOptional() @IsString() columns?: string;
  @IsOptional() @IsString() headers?: string;
}

class PreviewBodyDto {
  @IsUUID() sourceId: string;
  @IsIn(['all', 'filtered', 'selected']) scope: 'all' | 'filtered' | 'selected';
  @IsOptional() @IsArray() filters?: unknown[];
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_IDS) @IsString({ each: true }) ids?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_COLUMNS)
  @IsString({ each: true })
  columns?: string[];
  /** Nome alternativo no cabeçalho, por coluna */
  @IsOptional() @IsObject() headers?: Record<string, string>;
}

class ExportBodyDto extends PreviewBodyDto {
  @IsOptional() @IsIn([';', ',', 'tab', '|']) delimiter?: string;
  @IsOptional() @IsIn(['.', ',']) decimal?: '.' | ',';
}

class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/\S/, { message: 'Informe o nome do modelo' })
  name?: string;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_COLUMNS)
  @IsString({ each: true })
  columns?: string[];
  @IsOptional() @IsObject() headers?: Record<string, string>;
}

class CreateTemplateDto {
  @IsUUID() sourceId: string;
  @IsString()
  @MaxLength(100)
  @Matches(/\S/, { message: 'Informe o nome do modelo' })
  name: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_COLUMNS)
  @IsString({ each: true })
  columns: string[];
  @IsOptional() @IsObject() headers?: Record<string, string>;
}

@ApiTags('export')
@Controller('export')
export class ExportController {
  constructor(
    private readonly exporter: ExportService,
    private readonly templates: ExportTemplatesService,
  ) {}

  // Rotas fixas antes de ':format' (senão "templates"/"preview" seriam lidos como formato).

  @Get('templates')
  @ApiOperation({ summary: 'Modelos de exportação (colunas e ordem) de uma fonte' })
  listTemplates(@Query('sourceId', ParseUUIDPipe) sourceId: string) {
    return this.templates.list(sourceId);
  }

  @Post('templates')
  createTemplate(@Body() dto: CreateTemplateDto) {
    return this.templates.create(dto);
  }

  @Patch('templates/:id')
  updateTemplate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTemplateDto) {
    return this.templates.update(id, dto);
  }

  @Delete('templates/:id')
  removeTemplate(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.remove(id);
  }

  @Post('preview')
  @ApiOperation({ summary: 'Primeiras linhas do arquivo com as colunas escolhidas' })
  preview(@Body() body: PreviewBodyDto) {
    return this.exporter.preview({
      sourceId: body.sourceId,
      scope: body.scope,
      filters: parseFilters(body.filters),
      ids: body.ids,
      columns: body.columns,
      headers: cleanHeaders(body.headers),
    });
  }

  @Get(':format')
  @ApiOperation({
    summary:
      'Exporta todos/filtrados (download em streaming): /export/csv, xlsx, json (GeoJSON) ou kml',
  })
  async get(
    @Param('format', new ParseEnumPipe(Format)) format: ExportFormat,
    @Query() q: ExportQueryDto,
    @Res() res: Response,
  ) {
    await this.exporter.export(
      {
        sourceId: q.sourceId,
        format,
        scope: q.scope ?? 'all',
        filters: parseFilters(q.filters),
        delimiter: q.delimiter,
        decimal: q.decimal,
        columns: parseColumns(q.columns),
        headers: parseHeaders(q.headers),
      },
      res,
    );
  }

  @Post(':format')
  @ApiOperation({ summary: 'Exporta incluindo o escopo "selected" (IDs no corpo)' })
  async post(
    @Param('format', new ParseEnumPipe(Format)) format: ExportFormat,
    @Body() body: ExportBodyDto,
    @Res() res: Response,
  ) {
    await this.exporter.export(
      {
        sourceId: body.sourceId,
        format,
        scope: body.scope,
        filters: parseFilters(body.filters),
        ids: body.ids,
        delimiter: body.delimiter,
        decimal: body.decimal,
        columns: body.columns,
        headers: cleanHeaders(body.headers),
      },
      res,
    );
  }
}
