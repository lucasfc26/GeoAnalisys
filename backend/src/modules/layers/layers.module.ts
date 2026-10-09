import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Module,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../../common/current-user.decorator';
import { IdsDto } from '../points/dto/points.dto';
import { ImportConfig, LayersService, Upload } from './layers.service';

/** Tamanho máximo do arquivo importado. */
const MAX_FILE = 100 * 1024 * 1024;
const upload = FileInterceptor('file', { limits: { fileSize: MAX_FILE } });

class CopyToLayerDto extends IdsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  /** Padrão: GeoAnalisysTemp */
  @IsOptional()
  @IsString()
  schema?: string;
}

@ApiTags('layers')
@Controller('layers')
class LayersController {
  constructor(private readonly layers: LayersService) {}

  @Post('import/preview')
  @UseInterceptors(upload)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Lê um CSV/XLSX/GeoJSON: abas, colunas, tipos detectados, prévia e sugestões de ID/X/Y',
  })
  preview(@UploadedFile() file: Upload | undefined, @Body('sheet') sheet?: string) {
    return this.layers.preview(file, sheet || null);
  }

  @Post('import')
  @UseInterceptors(upload)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Importa um CSV/XLSX/GeoJSON como nova camada (tabela no banco + fonte de dados)',
  })
  import(
    @UploadedFile() file: Upload | undefined,
    @Body('config') config: string,
    @CurrentUser() user: string,
  ) {
    let cfg: ImportConfig;
    try {
      cfg = JSON.parse(config) as ImportConfig;
    } catch {
      throw new BadRequestException('Configuração da importação inválida');
    }
    return this.layers.import(file, cfg, user);
  }

  @Post('copy')
  @ApiOperation({
    summary: 'Copia os registros selecionados para uma nova tabela (padrão: schema GeoAnalisysTemp)',
  })
  copy(@Body() dto: CopyToLayerDto, @CurrentUser() user: string) {
    return this.layers.copyToLayer(dto.sourceId, dto.ids, dto.name, dto.schema, user);
  }

  @Delete('temp/:sourceId')
  @ApiOperation({
    summary:
      'Camada removida do mapa: apaga a tabela e a fonte se estiverem no schema GeoAnalisysTemp (outros schemas: nada)',
  })
  removeTemp(@Param('sourceId') sourceId: string, @CurrentUser() user: string) {
    return this.layers.removeTemp(sourceId, user);
  }
}

@Module({
  controllers: [LayersController],
  providers: [LayersService],
})
export class LayersModule {}
