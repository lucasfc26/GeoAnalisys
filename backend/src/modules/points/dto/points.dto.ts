import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
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
import { MAX_LABEL_EXPR } from '../../../common/label-expr';

export const MAX_IDS = 200_000;

export class SourceQueryDto {
  @ApiProperty()
  @IsUUID()
  sourceId: string;
}

export class FilteredQueryDto extends SourceQueryDto {
  @ApiPropertyOptional({ description: 'JSON: [{"column":"status","op":"eq","value":"Ativo"}]' })
  @IsOptional()
  @IsString()
  filters?: string;
}

export class BboxQueryDto extends FilteredQueryDto {
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) minLat: number;
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) maxLat: number;
  @Type(() => Number) @IsNumber() @Min(-360) @Max(360) minLng: number;
  @Type(() => Number) @IsNumber() @Min(-360) @Max(360) maxLng: number;

  @ApiPropertyOptional({ description: 'Máximo de coordenadas antes de agrupar em clusters' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20000)
  limit?: number;

  @ApiPropertyOptional({ description: 'Coluna usada para colorir por categoria' })
  @IsOptional()
  @IsString()
  styleColumn?: string;

  @ApiPropertyOptional({
    description: `Expressão de rótulo (sintaxe QGIS): "ID" || ' ' || "medicao"`,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_LABEL_EXPR)
  label?: string;
}

export class LayerQueryDto extends FilteredQueryDto {
  @ApiPropertyOptional({ description: 'Coluna usada para colorir por categoria' })
  @IsOptional()
  @IsString()
  styleColumn?: string;

  @ApiPropertyOptional({
    description: `Expressão de rótulo (sintaxe QGIS): "ID" || ' ' || "medicao"`,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_LABEL_EXPR)
  label?: string;

  @ApiPropertyOptional({
    description: 'Versão em cache no cliente; se ainda valer, responde mode=unchanged',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  version?: string;
}

export class LabelPreviewDto extends SourceQueryDto {
  @IsString()
  @MaxLength(MAX_LABEL_EXPR)
  label: string;
}

export class ListQueryDto extends FilteredQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) pageSize?: number;
}

export class AtQueryDto extends FilteredQueryDto {
  @Type(() => Number) @IsNumber() x: number;
  @Type(() => Number) @IsNumber() y: number;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  idsOnly?: boolean;
}

export class SearchQueryDto extends SourceQueryDto {
  @IsString() q: string;
}

export class LatLngDto {
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat: number;
  @Type(() => Number) @IsNumber() @Min(-360) @Max(360) lng: number;
}

export class SelectionDto {
  @IsUUID() sourceId: string;

  @ApiProperty({ type: [LatLngDto], description: 'Vértices do polígono (retângulo = 4 vértices)' })
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => LatLngDto)
  polygon: LatLngDto[];

  @IsOptional() @IsArray() filters?: unknown[];
}

export class IdsDto {
  @IsUUID() sourceId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_IDS)
  @IsString({ each: true })
  ids: string[];
}

export class RecordsDto {
  @IsUUID() sourceId: string;

  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  ids: string[];

  @IsOptional() @IsBoolean() full?: boolean;
}

export class SummaryDto extends IdsDto {
  @IsOptional() @IsString() column?: string;

  @ApiPropertyOptional({
    description: 'Várias colunas: agrupa pela combinação dos valores (ex.: "ME 70")',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  columns?: string[];
}

export class CreatePointDto {
  @IsUUID() sourceId: string;

  @ApiProperty({
    description: 'Valores das colunas (incluindo as colunas X/Y, se não usar lat/lng)',
  })
  @IsObject()
  data: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Alternativa às colunas X/Y: posição clicada no mapa' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lat?: number;

  @IsOptional() @Type(() => Number) @IsNumber() lng?: number;

  @ApiPropertyOptional({ description: 'Motivo da inclusão (Tabela de Alterações)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  observation?: string;
}

export class BulkDeleteDto extends IdsDto {
  @ApiPropertyOptional({ description: 'Motivo da exclusão (Tabela de Alterações)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  observation?: string;
}

export class UpdatePointDto {
  @IsUUID() sourceId: string;

  @IsObject()
  data: Record<string, unknown>;
}

export class QueryDto {
  @IsUUID() sourceId: string;

  @ApiProperty({
    description: 'Filtros (mesmo formato da camada), com caseSensitive opcional por filtro',
  })
  @IsArray()
  @ArrayMinSize(1)
  filters: unknown[];
}

export const MAX_LOOKUP_VALUES = 5000;

export class LookupDto {
  @IsUUID() sourceId: string;

  @ApiProperty({ description: 'Coluna onde procurar os valores' })
  @IsString()
  column: string;

  @ApiProperty({ description: 'Valores a localizar (na ordem desejada)' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_LOOKUP_VALUES)
  @IsString({ each: true })
  values: string[];
}

export class TranslateDto extends IdsDto {
  @ApiProperty({
    enum: ['move', 'copy'],
    description: 'move = desloca os registros; copy = cria cópias deslocadas',
  })
  @IsIn(['move', 'copy'])
  mode: 'move' | 'copy';

  @ApiProperty({ type: LatLngDto, description: 'Ponto de referência (origem do arraste)' })
  @ValidateNested()
  @Type(() => LatLngDto)
  from: LatLngDto;

  @ApiProperty({ type: LatLngDto, description: 'Destino do ponto de referência' })
  @ValidateNested()
  @Type(() => LatLngDto)
  to: LatLngDto;

  @ApiPropertyOptional({ description: 'Motivo (duplicar: Tabela de Alterações)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  observation?: string;
}

export class BulkUpdateDto extends IdsDto {
  @ApiProperty({ example: { status: 'Ativo' } })
  @IsObject()
  changes: Record<string, unknown>;
}
