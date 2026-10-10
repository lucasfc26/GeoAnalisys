import { Body, Controller, Param, ParseEnumPipe, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { Response } from 'express';
import { parseFilters } from '../../common/filters';
import { MAX_CRITERIA } from './association.logic';
import { AssociationRequest, AssociationService, StatusRule } from './association.service';

const MAX_DISTANCE = 5000;
const MAX_COLUMNS = 4000;
const MIN_WEIGHT = 0.01;
const MAX_WEIGHT = 1000;
const MAX_VALUE_NAMES = 500;

enum Format {
  xlsx = 'xlsx',
  csv = 'csv',
}

class LayerDto {
  @IsUUID() sourceId: string;
  @IsOptional() @IsArray() filters?: unknown[];
}

class StatusAttributeDto {
  @IsIn(['A', 'B']) side: 'A' | 'B';
  @IsString() @MaxLength(200) column: string;
  /** Valor → nome no Status */
  @IsOptional() @IsObject() labels?: Record<string, unknown>;
}

class StatusRuleDto {
  @IsOptional() @IsBoolean() consider?: boolean;
  @IsOptional() @IsBoolean() unique?: boolean;
  @IsOptional() @ValidateNested() @Type(() => StatusAttributeDto) attribute?: StatusAttributeDto | null;
}

class UnmatchedStatusDto {
  @IsOptional() @ValidateNested() @Type(() => StatusRuleDto) newPoints?: StatusRuleDto;
  @IsOptional() @ValidateNested() @Type(() => StatusRuleDto) unidentified?: StatusRuleDto;
}

class CriterionDto {
  @IsString() @MaxLength(200) columnA: string;
  @IsString() @MaxLength(200) columnB: string;
  @Type(() => Number) @IsNumber() @Min(0) @Max(MAX_DISTANCE) maxDistance: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(MIN_WEIGHT) @Max(MAX_WEIGHT) weight?: number;
  @IsOptional() @ValidateNested() @Type(() => StatusRuleDto) status?: StatusRuleDto;
}

class AggregatesDto {
  @Type(() => Number) @IsNumber() @Min(0) @Max(MAX_DISTANCE) maxDistance: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(MIN_WEIGHT) @Max(MAX_WEIGHT) weight?: number;
  @IsOptional() @ValidateNested() @Type(() => StatusRuleDto) status?: StatusRuleDto;
}

function toStatusRule(dto: StatusRuleDto | undefined): StatusRule | undefined {
  if (!dto) return undefined;
  const at = dto.attribute;
  const labels = Object.entries(at?.labels ?? {})
    .filter((e): e is [string, string] => typeof e[1] === 'string')
    .slice(0, MAX_VALUE_NAMES)
    .map(([v, n]) => [v.slice(0, 500), n.slice(0, 200)]);
  return {
    consider: dto.consider,
    unique: dto.unique,
    attribute: at ? { side: at.side, column: at.column, labels: Object.fromEntries(labels) } : null,
  };
}

class AssociationDto {
  @ValidateNested() @Type(() => LayerDto) a: LayerDto;
  @ValidateNested() @Type(() => LayerDto) b: LayerDto;
  @Type(() => Number) @IsNumber() @Min(0) @Max(MAX_DISTANCE) maxDistance: number;
  // Uma vaga fica para a prioridade de agregados.
  @IsArray()
  @ArrayMaxSize(MAX_CRITERIA - 1)
  @ValidateNested({ each: true })
  @Type(() => CriterionDto)
  criteria: CriterionDto[];
  @IsOptional() @ValidateNested() @Type(() => AggregatesDto) aggregates?: AggregatesDto;
  @IsOptional() @IsBoolean() includeUnmatchedB?: boolean;
  @IsOptional() @ValidateNested() @Type(() => UnmatchedStatusDto) unmatchedStatus?: UnmatchedStatusDto;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_COLUMNS)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  columns?: string[];
}

function toRequest(dto: AssociationDto): AssociationRequest {
  return {
    a: { sourceId: dto.a.sourceId, filters: parseFilters(dto.a.filters) },
    b: { sourceId: dto.b.sourceId, filters: parseFilters(dto.b.filters) },
    maxDistance: dto.maxDistance,
    criteria: dto.criteria.map((c) => ({
      columnA: c.columnA,
      columnB: c.columnB,
      maxDistance: c.maxDistance,
      weight: c.weight,
      status: toStatusRule(c.status),
    })),
    aggregates: dto.aggregates
      ? {
          maxDistance: dto.aggregates.maxDistance,
          weight: dto.aggregates.weight,
          status: toStatusRule(dto.aggregates.status),
        }
      : null,
    includeUnmatchedB: dto.includeUnmatchedB ?? false,
    unmatchedStatus: {
      newPoints: toStatusRule(dto.unmatchedStatus?.newPoints),
      unidentified: toStatusRule(dto.unmatchedStatus?.unidentified),
    },
    columns: dto.columns,
  };
}

@ApiTags('association')
@Controller('association')
export class AssociationController {
  constructor(private readonly association: AssociationService) {}

  @Post('preview')
  @ApiOperation({ summary: 'Associa 1 para 1 os pontos mais próximos de duas camadas (resumo e prévia)' })
  preview(@Body() dto: AssociationDto) {
    return this.association.preview(toRequest(dto));
  }

  @Post(':format')
  @ApiOperation({ summary: 'Resultado completo da associação em XLSX ou CSV' })
  async download(
    @Param('format', new ParseEnumPipe(Format)) format: Format,
    @Body() dto: AssociationDto,
    @Res() res: Response,
  ) {
    await this.association.download(toRequest(dto), format, res);
  }
}
