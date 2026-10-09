import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString } from 'class-validator';
import { CrsService } from './crs.service';

class ToLatLngDto {
  @IsString() coordinateSystem: string;
  @IsOptional() @IsString() proj4?: string;
  @Type(() => Number) @IsNumber() x: number;
  @Type(() => Number) @IsNumber() y: number;
}

class ToXYDto {
  @IsString() coordinateSystem: string;
  @IsOptional() @IsString() proj4?: string;
  @Type(() => Number) @IsNumber() lat: number;
  @Type(() => Number) @IsNumber() lng: number;
}

@ApiTags('maps')
@Controller('maps')
export class MapsController {
  constructor(private readonly crs: CrsService) {}

  @Get('crs')
  listCrs() {
    return this.crs.list().map(({ proj4, ...rest }) => ({ ...rest, proj4 }));
  }

  @Post('convert/to-latlng')
  toLatLng(@Body() dto: ToLatLngDto) {
    const h = this.crs.resolve(dto.coordinateSystem, dto.proj4);
    const r = h.toLatLng(dto.x, dto.y);
    if (!r) throw new BadRequestException(`Coordenada inválida para ${h.def.name}`);
    return r;
  }

  @Post('convert/to-xy')
  toXY(@Body() dto: ToXYDto) {
    const h = this.crs.resolve(dto.coordinateSystem, dto.proj4);
    const r = h.toXY(dto.lat, dto.lng);
    if (!r || !h.isValid(r.x, r.y)) {
      throw new BadRequestException(`Ponto fora da área válida de ${h.def.name} (verifique a zona UTM)`);
    }
    return r;
  }
}
