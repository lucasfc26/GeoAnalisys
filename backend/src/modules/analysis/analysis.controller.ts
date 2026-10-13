import { Body, Controller, Post } from '@nestjs/common';
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
import { parseFilters } from '../../common/filters';
import { AnalysisService } from './analysis.service';

const MAX_DISTANCE = 1_000_000;

class LayerDto {
  @IsUUID() sourceId: string;
  @IsOptional() @IsArray() filters?: unknown[];
}

class ColumnLayerDto extends LayerDto {
  @IsString() @MaxLength(200) column: string;
}

class OutsideDto {
  @ValidateNested() @Type(() => LayerDto) layer: LayerDto;
  @IsOptional() @IsString() @MaxLength(300) boundaryName?: string;
  /** [[[lng, lat], …], …] por polígono; validado no serviço */
  @IsArray() polygons: unknown[];
  @Type(() => Number) @IsNumber() @Min(0) @Max(MAX_DISTANCE) tolerance: number;
}

class AttributeDistanceDto {
  @ValidateNested() @Type(() => ColumnLayerDto) layer: ColumnLayerDto;
  @IsOptional() @ValidateNested() @Type(() => ColumnLayerDto) reference?: ColumnLayerDto | null;
  @Type(() => Number) @IsNumber() @Min(0) @Max(MAX_DISTANCE) maxDistance: number;
  @IsOptional() @IsIn(['median', 'mean']) center?: 'median' | 'mean';
  @IsOptional() @Type(() => Number) @IsInt() @Min(2) @Max(100_000) minPoints?: number;
  @IsOptional() @IsBoolean() stripZeros?: boolean;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  ignore?: string[];
}

@ApiTags('analysis')
@Controller('analysis')
export class AnalysisController {
  constructor(private readonly analysis: AnalysisService) {}

  @Post('outside')
  @ApiOperation({ summary: 'Pontos fora de um limite (polígonos) e a distância até a borda' })
  outside(@Body() dto: OutsideDto) {
    return this.analysis.outside({
      layer: { sourceId: dto.layer.sourceId, filters: parseFilters(dto.layer.filters) },
      boundaryName: dto.boundaryName ?? 'Limite',
      polygons: dto.polygons,
      tolerance: dto.tolerance,
    });
  }

  @Post('attribute-distance')
  @ApiOperation({
    summary:
      'Pontos longe do ponto da referência com o mesmo valor de atributo (ou do centro dos pontos com o mesmo valor)',
  })
  attributeDistance(@Body() dto: AttributeDistanceDto) {
    const ref = dto.reference;
    return this.analysis.attributeDistance({
      layer: {
        sourceId: dto.layer.sourceId,
        filters: parseFilters(dto.layer.filters),
        column: dto.layer.column,
      },
      reference: ref
        ? { sourceId: ref.sourceId, filters: parseFilters(ref.filters), column: ref.column }
        : null,
      maxDistance: dto.maxDistance,
      center: dto.center ?? 'median',
      minPoints: dto.minPoints ?? 2,
      stripZeros: dto.stripZeros ?? true,
      ignore: dto.ignore ?? [],
    });
  }
}
