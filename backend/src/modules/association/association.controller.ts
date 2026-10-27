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
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { Response } from 'express';
import { CurrentUser } from '../../common/current-user.decorator';
import { parseFilters } from '../../common/filters';
import { MAX_CRITERIA } from './association.logic';
import {
  AssociationLayerTarget,
  AssociationRequest,
  AssociationService,
  StatusRule,
} from './association.service';

const MAX_DISTANCE = 5000;
const MAX_COLUMNS = 4000;
/** Penalidade de prioridade e custo de ponto sem par, em metros */
const MAX_PENALTY = 1_000_000;
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
  @IsOptional()
  @ValidateNested()
  @Type(() => StatusAttributeDto)
  attribute?: StatusAttributeDto | null;
}

class UnmatchedStatusDto {
  @IsOptional() @ValidateNested() @Type(() => StatusRuleDto) newPoints?: StatusRuleDto;
  @IsOptional() @ValidateNested() @Type(() => StatusRuleDto) unidentified?: StatusRuleDto;
}

class CriterionDto {
  @IsString() @MaxLength(200) columnA: string;
  @IsString() @MaxLength(200) columnB: string;
  @Type(() => Number) @IsNumber() @Min(0) @Max(MAX_DISTANCE) maxDistance: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(MAX_PENALTY) weight?: number;
  @IsOptional() @ValidateNested() @Type(() => StatusRuleDto) status?: StatusRuleDto;
}

class AggregatesDto {
  @Type(() => Number) @IsNumber() @Min(0) @Max(MAX_DISTANCE) maxDistance: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(MAX_PENALTY) weight?: number;
  @IsOptional() @ValidateNested() @Type(() => StatusRuleDto) status?: StatusRuleDto;
}

class AddressDto {
  @IsString() @MaxLength(200) columnA: string;
  @IsString() @MaxLength(200) columnB: string;
  @Type(() => Number) @IsNumber() @Min(0) @Max(MAX_DISTANCE) maxDistance: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(MAX_PENALTY) weight?: number;
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
  // Duas vagas ficam para as prioridades de endereço e de agregados.
  @IsArray()
  @ArrayMaxSize(MAX_CRITERIA - 2)
  @ValidateNested({ each: true })
  @Type(() => CriterionDto)
  criteria: CriterionDto[];
  @IsOptional() @ValidateNested() @Type(() => AggregatesDto) aggregates?: AggregatesDto;
  @IsOptional() @ValidateNested() @Type(() => AddressDto) address?: AddressDto | null;
  /** Custo em metros de deixar um ponto sem par (ausente/null = associar o máximo possível) */
  @IsOptional()
  @ValidateIf((o: AssociationDto) => o.unmatchedCost !== null)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(MAX_PENALTY)
  unmatchedCost?: number | null;
  @IsOptional() @IsBoolean() includeUnmatchedB?: boolean;
  /** Status gerado → nome escolhido */
  @IsOptional() @IsObject() statusRenames?: Record<string, unknown>;
  @IsOptional()
  @ValidateNested()
  @Type(() => UnmatchedStatusDto)
  unmatchedStatus?: UnmatchedStatusDto;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_COLUMNS)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  columns?: string[];
}

class LayerTargetDto {
  @IsIn(['create', 'replace']) mode: 'create' | 'replace';
  /** Nome da nova camada (mode = create) */
  @ValidateIf((o: LayerTargetDto) => o.mode === 'create')
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;
  /** Camada de GeoAnalisysTemp a substituir (mode = replace) */
  @ValidateIf((o: LayerTargetDto) => o.mode === 'replace') @IsUUID() sourceId?: string;
  /** Acrescenta/apaga colunas para ficar igual ao resultado (mode = replace) */
  @IsOptional() @IsBoolean() adjustColumns?: boolean;
  /** Grava também as coordenadas convertidas (UTM X/Y e zona) */
  @IsOptional() @IsBoolean() convertCoordinates?: boolean;
}

class AssociationLayerDto extends AssociationDto {
  @ValidateNested() @Type(() => LayerTargetDto) target: LayerTargetDto;
}

class ReviewDto extends AssociationDto {
  /** Par distante: acima desta distância em metros (null = não procura) */
  @IsOptional()
  @ValidateIf((o: ReviewDto) => o.farDistance !== null)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(MAX_DISTANCE)
  farDistance?: number | null;
  /** Par dúbio: margem (2º melhor candidato − par) abaixo destes metros (null = não procura) */
  @IsOptional()
  @ValidateIf((o: ReviewDto) => o.maxMargin !== null)
  @Type(() => Number)
  @IsNumber()
  @Min(-MAX_PENALTY)
  @Max(MAX_PENALTY)
  maxMargin?: number | null;
}

class FixCoordinatesDto extends AssociationDto {
  /** Camada cujos pontos recebem a coordenada do ponto associado da outra */
  @IsIn(['A', 'B']) from: 'A' | 'B';
  /** Só pares a mais desta distância (m) */
  @Type(() => Number) @IsNumber() @Min(0) @Max(MAX_DISTANCE) minDistance: number;
  /** Só conta os pontos, sem mover */
  @IsOptional() @IsBoolean() dryRun?: boolean;
}

function toTarget(dto: LayerTargetDto): AssociationLayerTarget {
  return dto.mode === 'create'
    ? { mode: 'create', name: dto.name!, convertCoordinates: dto.convertCoordinates ?? false }
    : {
        mode: 'replace',
        sourceId: dto.sourceId!,
        adjustColumns: dto.adjustColumns ?? false,
        convertCoordinates: dto.convertCoordinates ?? false,
      };
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
    address: dto.address
      ? {
          columnA: dto.address.columnA,
          columnB: dto.address.columnB,
          maxDistance: dto.address.maxDistance,
          weight: dto.address.weight,
          status: toStatusRule(dto.address.status),
        }
      : null,
    unmatchedCost: dto.unmatchedCost ?? null,
    includeUnmatchedB: dto.includeUnmatchedB ?? false,
    statusRenames: Object.fromEntries(
      Object.entries(dto.statusRenames ?? {})
        .filter((e): e is [string, string] => typeof e[1] === 'string' && !!e[1].trim())
        .slice(0, MAX_VALUE_NAMES)
        .map(([from, to]) => [from.slice(0, 1000), to.trim().slice(0, 200)]),
    ),
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
  @ApiOperation({
    summary: 'Associa 1 para 1 os pontos mais próximos de duas camadas (resumo e prévia)',
  })
  preview(@Body() dto: AssociationDto) {
    return this.association.preview(toRequest(dto));
  }

  @Post('layer')
  @ApiOperation({
    summary:
      'Grava o resultado como camada temporária em GeoAnalisysTemp: nova ou substituindo (TRUNCATE) uma existente',
  })
  toLayer(@Body() dto: AssociationLayerDto, @CurrentUser() user: string) {
    return this.association.toLayer(toRequest(dto), toTarget(dto.target), user);
  }

  @Post('review')
  @ApiOperation({ summary: 'Pares associados distantes ou dúbios, para revisar no mapa' })
  review(@Body() dto: ReviewDto) {
    return this.association.review(toRequest(dto), {
      farDistance: dto.farDistance ?? null,
      maxMargin: dto.maxMargin ?? null,
    });
  }

  @Post('fix-coordinates')
  @ApiOperation({
    summary:
      'Move os pontos de uma camada para a coordenada do ponto associado da outra, acima de uma distância',
  })
  fixCoordinates(@Body() dto: FixCoordinatesDto, @CurrentUser() user: string) {
    return this.association.fixCoordinates(
      toRequest(dto),
      dto.from,
      dto.minDistance,
      dto.dryRun ?? false,
      user,
    );
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
