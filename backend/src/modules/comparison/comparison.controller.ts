import { Body, Controller, Param, ParseEnumPipe, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { Response } from 'express';
import { parseFilters } from '../../common/filters';
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
  @IsOptional() @IsString() @MaxLength(200) factorColumn?: string | null;
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
          factorColumn: lk.factorColumn || null,
        }
      : null,
    ignoreCase: dto.ignoreCase ?? true,
  };
}

@ApiTags('comparison')
@Controller('comparison')
export class ComparisonController {
  constructor(private readonly comparison: ComparisonService) {}

  @Post('preview')
  @ApiOperation({
    summary: 'Lista comparativa: contagem por grupo de atributos em cada camada, lado a lado',
  })
  preview(@Body() dto: ComparisonDto) {
    return this.comparison.run(toRequest(dto));
  }

  @Post(':format')
  @ApiOperation({ summary: 'Lista comparativa em XLSX ou CSV' })
  async download(
    @Param('format', new ParseEnumPipe(Format)) format: Format,
    @Body() dto: ComparisonDto,
    @Res() res: Response,
  ) {
    await this.comparison.download(toRequest(dto), format, res);
  }
}
