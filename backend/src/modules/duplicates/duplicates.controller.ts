import { Body, Controller, Param, ParseEnumPipe, Post, Res, applyDecorators } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
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
import { MAX_RULES } from './duplicates.logic';
import { DuplicatesRequest, DuplicatesService } from './duplicates.service';

const MAX_RADIUS = 1000;
const MAX_REFERENCE_DISTANCE = 5000;
const MAX_WEIGHT = 1000;

enum Format {
  xlsx = 'xlsx',
  csv = 'csv',
}

/** Peso de uma regra: negativo diminui a chance de duplicidade. */
const Weight = () =>
  applyDecorators(
    Type(() => Number),
    IsNumber(),
    Min(-MAX_WEIGHT),
    Max(MAX_WEIGHT),
  );

class LayerDto {
  @IsUUID() sourceId: string;
  @IsOptional() @IsArray() filters?: unknown[];
}

class RuleDto {
  @IsString() @MaxLength(200) column: string;
  @IsIn(['equal', 'different']) mode: 'equal' | 'different';
  @IsIn(['radius', 'sameCoord']) scope: 'radius' | 'sameCoord';
  @Weight() weight: number;
}

class ReferenceDto extends LayerDto {
  @Type(() => Number) @IsNumber() @Min(0) @Max(MAX_REFERENCE_DISTANCE) maxDistance: number;
  /** Ausente nas configurações antigas: sem peso */
  @IsOptional() @Weight() sharedMatched?: number;
  @Weight() bothMatched: number;
  @Weight() oneMatched: number;
  @Weight() noneMatched: number;
}

class DensityDto {
  @Type(() => Number) @IsNumber() @Min(0) @Max(MAX_RADIUS) radius: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(100_000) minCount: number;
  @Weight() weight: number;
}

class IdsDto {
  /** Coluna comparada (ausente/null = ID da camada) */
  @IsOptional() @IsString() @MaxLength(200) column?: string | null;
  @Type(() => Number) @IsNumber() @Min(0) @Max(1_000_000) maxGap: number;
  @Weight() sequential: number;
  @Weight() unrelated: number;
}

class DuplicatesDto {
  @ValidateNested() @Type(() => LayerDto) layer: LayerDto;
  @Type(() => Number) @IsNumber() @Min(0) @Max(MAX_RADIUS) radius: number;
  @Weight() sameCoordWeight: number;
  @IsArray()
  @ArrayMaxSize(MAX_RULES)
  @ValidateNested({ each: true })
  @Type(() => RuleDto)
  rules: RuleDto[];
  @IsOptional() @ValidateNested() @Type(() => ReferenceDto) reference?: ReferenceDto | null;
  @IsOptional() @ValidateNested() @Type(() => DensityDto) density?: DensityDto | null;
  @IsOptional() @ValidateNested() @Type(() => IdsDto) ids?: IdsDto | null;
  @Type(() => Number) @IsNumber() @Min(-100_000) @Max(100_000) minScore: number;
  @IsOptional() @IsBoolean() includeNearby?: boolean;
}

function toRequest(dto: DuplicatesDto): DuplicatesRequest {
  const ref = dto.reference;
  return {
    layer: { sourceId: dto.layer.sourceId, filters: parseFilters(dto.layer.filters) },
    radius: dto.radius,
    sameCoordWeight: dto.sameCoordWeight,
    rules: dto.rules.map((r) => ({
      column: r.column,
      mode: r.mode,
      scope: r.scope,
      weight: r.weight,
    })),
    reference: ref
      ? {
          sourceId: ref.sourceId,
          filters: parseFilters(ref.filters),
          maxDistance: ref.maxDistance,
          sharedMatched: ref.sharedMatched ?? 0,
          bothMatched: ref.bothMatched,
          oneMatched: ref.oneMatched,
          noneMatched: ref.noneMatched,
        }
      : null,
    density: dto.density
      ? { radius: dto.density.radius, minCount: dto.density.minCount, weight: dto.density.weight }
      : null,
    ids: dto.ids
      ? {
          column: dto.ids.column || null,
          maxGap: dto.ids.maxGap,
          sequential: dto.ids.sequential,
          unrelated: dto.ids.unrelated,
        }
      : null,
    minScore: dto.minScore,
    includeNearby: dto.includeNearby ?? true,
  };
}

@ApiTags('duplicates')
@Controller('duplicates')
export class DuplicatesController {
  constructor(private readonly duplicates: DuplicatesService) {}

  @Post('preview')
  @ApiOperation({
    summary: 'Pares de pontos próximos que podem ser coleta duplicada (resumo e prévia)',
  })
  preview(@Body() dto: DuplicatesDto) {
    return this.duplicates.preview(toRequest(dto));
  }

  @Post(':format')
  @ApiOperation({ summary: 'Todos os pares suspeitos de duplicidade em XLSX ou CSV' })
  async download(
    @Param('format', new ParseEnumPipe(Format)) format: Format,
    @Body() dto: DuplicatesDto,
    @Res() res: Response,
  ) {
    await this.duplicates.download(toRequest(dto), format, res);
  }
}
