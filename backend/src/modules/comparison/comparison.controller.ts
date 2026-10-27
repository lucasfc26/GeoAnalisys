import { Body, Controller, Param, ParseEnumPipe, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { Response } from 'express';
import { parseFilters } from '../../common/filters';
import type { ComparisonColumnKind } from './comparison.columns';
import { ComparisonRequest, ComparisonService } from './comparison.service';

enum Format {
  xlsx = 'xlsx',
  csv = 'csv',
}

class LayerDto {
  @IsUUID() sourceId: string;
  @IsOptional() @IsString() @MaxLength(200) label?: string | null;
  @IsOptional() @IsArray() filters?: unknown[];
}

class BlockDto {
  @IsString() @MinLength(1) @MaxLength(200) title: string;
  @IsOptional() @IsArray() conditions?: unknown[];
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  groupBy: string[];
  @IsOptional() @IsString() @MaxLength(200) distinctColumn?: string | null;
  @IsOptional() @IsBoolean() useLookup?: boolean;
}

class LookupKeyDto {
  @IsString() @MaxLength(200) column: string;
  @IsString() @MaxLength(200) lookupColumn: string;
}

class LookupDto {
  @IsString() @MaxLength(200) schema: string;
  @IsString() @MaxLength(200) table: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => LookupKeyDto)
  keys: LookupKeyDto[];
  @IsOptional() @IsString() @MaxLength(200) nameColumn?: string | null;
}

class ColumnDto {
  @IsIn(['label', 'group', 'count', 'diff', 'lookup', 'formula']) kind: ComparisonColumnKind;
  @IsOptional() @IsString() @MaxLength(200) title?: string | null;
  @IsOptional() @IsString() @MaxLength(200) column?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(9) layer?: number | null;
  @IsOptional() @IsString() @MaxLength(2000) expression?: string | null;
  @IsOptional() @IsBoolean() hidden?: boolean;
  @IsOptional() @IsBoolean() sum?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(10) decimals?: number | null;
}

class ComparisonDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => LayerDto)
  layers: LayerDto[];
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => BlockDto)
  blocks: BlockDto[];
  @IsOptional() @ValidateNested() @Type(() => LookupDto) lookup?: LookupDto | null;
  @IsOptional() @IsBoolean() ignoreCase?: boolean;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => ColumnDto)
  columns?: ColumnDto[] | null;
}

function toRequest(dto: ComparisonDto): ComparisonRequest {
  const lk = dto.lookup;
  return {
    layers: dto.layers.map((l) => ({
      sourceId: l.sourceId,
      label: l.label ?? null,
      filters: parseFilters(l.filters),
    })),
    blocks: dto.blocks.map((b) => ({
      title: b.title.trim(),
      conditions: parseFilters(b.conditions),
      groupBy: b.groupBy,
      distinctColumn: b.distinctColumn || null,
      useLookup: b.useLookup ?? false,
    })),
    lookup: lk
      ? {
          schema: lk.schema,
          table: lk.table,
          keys: lk.keys.map((k) => ({ column: k.column, lookupColumn: k.lookupColumn })),
          nameColumn: lk.nameColumn || null,
        }
      : null,
    ignoreCase: dto.ignoreCase ?? true,
    columns: dto.columns
      ? dto.columns.map((c) => ({
          kind: c.kind,
          title: c.title?.trim() || null,
          column: c.column || null,
          layer: c.layer ?? null,
          expression: c.expression ?? null,
          hidden: c.hidden ?? false,
          sum: c.sum ?? false,
          decimals: c.decimals ?? null,
        }))
      : null,
  };
}

@ApiTags('comparison')
@Controller('comparison')
export class ComparisonController {
  constructor(private readonly comparison: ComparisonService) {}

  @Post('preview')
  @ApiOperation({
    summary: 'Quadro Comparativo: contagem por grupo de atributos em cada camada, lado a lado',
  })
  preview(@Body() dto: ComparisonDto) {
    return this.comparison.run(toRequest(dto));
  }

  @Post('unmatched')
  @ApiOperation({
    summary:
      'IDs dos pontos de cada camada que estão num grupo sem correspondência na tabela de apoio',
  })
  unmatched(@Body() dto: ComparisonDto) {
    return this.comparison.unmatchedPoints(toRequest(dto));
  }

  @Post(':format')
  @ApiOperation({ summary: 'Quadro Comparativo em XLSX ou CSV' })
  async download(
    @Param('format', new ParseEnumPipe(Format)) format: Format,
    @Body() dto: ComparisonDto,
    @Res() res: Response,
  ) {
    await this.comparison.download(toRequest(dto), format, res);
  }
}
