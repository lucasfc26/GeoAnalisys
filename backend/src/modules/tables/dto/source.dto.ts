import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SourceConfigDto {
  @ApiProperty({ example: 'Censo Atual' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: 'public' })
  @IsString()
  @MinLength(1)
  schema: string;

  @ApiProperty({ example: 'Censo_Atual' })
  @IsString()
  @MinLength(1)
  tableName: string;

  @ApiProperty({ example: 'ID', description: 'Coluna que identifica cada registro (de preferência única)' })
  @IsString()
  @MinLength(1)
  idColumn: string;

  @ApiProperty({ example: 'utm_x' })
  @IsString()
  @MinLength(1)
  xColumn: string;

  @ApiProperty({ example: 'utm_y' })
  @IsString()
  @MinLength(1)
  yColumn: string;

  @ApiProperty({ example: 'EPSG:31984' })
  @IsString()
  coordinateSystem: string;

  @ApiPropertyOptional({ description: 'Definição proj4 quando coordinateSystem = CUSTOM' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  proj4?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  labelColumn?: string | null;

  @ApiPropertyOptional({ description: 'Coluna usada no resumo por categoria (ex.: tipo, status)' })
  @IsOptional()
  @IsString()
  categoryColumn?: string | null;

  @ApiPropertyOptional({ description: 'Coluna PostGIS mantida sincronizada com X/Y' })
  @IsOptional()
  @IsString()
  geometryColumn?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  searchColumns?: string[];
}

export class UpdateSourceDto extends PartialType(SourceConfigDto) {}
