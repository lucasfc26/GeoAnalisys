import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { randomUUID } from 'crypto';
import { createWriteStream, mkdirSync, unlink } from 'fs';
import { extname, join } from 'path';
import { CurrentUser } from '../../common/current-user.decorator';
import { IdsDto } from '../points/dto/points.dto';
import { ImportConfig, LayersService, StoredUpload, UPLOAD_DIR } from './layers.service';

/** Tamanho máximo do arquivo importado (IMPORT_MAX_MB, padrão 2 GB). */
const MAX_FILE = (Number(process.env.IMPORT_MAX_MB) || 2048) * 1024 * 1024;

/**
 * Upload gravado direto em disco (arquivos de centenas de MB não passam pela memória). Interface de
 * armazenamento do multer: _handleFile grava, _removeFile apaga (ex.: passou do limite).
 */
const diskStore = {
  _handleFile(
    _req: unknown,
    file: { stream: NodeJS.ReadableStream; originalname: string },
    cb: (err: Error | null, info?: { path: string; size: number }) => void,
  ) {
    try {
      mkdirSync(UPLOAD_DIR, { recursive: true });
    } catch (e) {
      cb(e as Error);
      return;
    }
    const path = join(
      UPLOAD_DIR,
      `${randomUUID()}${extname(file.originalname || '').toLowerCase()}`,
    );
    const out = createWriteStream(path);
    out.on('error', (e) => cb(e));
    out.on('finish', () => cb(null, { path, size: out.bytesWritten }));
    file.stream.pipe(out);
  },
  _removeFile(_req: unknown, file: { path?: string }, cb: (err: Error | null) => void) {
    if (file.path) unlink(file.path, () => cb(null));
    else cb(null);
  },
};
const upload = FileInterceptor('file', { storage: diskStore, limits: { fileSize: MAX_FILE } });

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
    summary:
      'Recebe um CSV/XLSX/GeoJSON (ou o uploadId de um já enviado) e lê só o começo: abas, colunas, tipos detectados, prévia e sugestões de ID/X/Y',
  })
  preview(
    @UploadedFile() file: StoredUpload | undefined,
    @Body('uploadId') uploadId?: string,
    @Body('sheet') sheet?: string,
  ) {
    if (!file && !uploadId)
      throw new BadRequestException('Envie um arquivo .csv, .xlsx, .geojson ou .kml');
    return this.layers.preview(file, uploadId || null, sheet || null);
  }

  @Post('import')
  @ApiOperation({
    summary:
      'Começa a importar o arquivo enviado como nova camada (em segundo plano); devolve o id da tarefa',
  })
  import(
    @Body('uploadId') uploadId: string,
    @Body('config') config: ImportConfig | string,
    @CurrentUser() user: string,
  ) {
    let cfg: ImportConfig;
    try {
      cfg = typeof config === 'string' ? (JSON.parse(config) as ImportConfig) : config;
    } catch {
      throw new BadRequestException('Configuração da importação inválida');
    }
    if (!cfg || typeof cfg !== 'object' || typeof uploadId !== 'string')
      throw new BadRequestException('Configuração da importação inválida');
    return this.layers.startImport(uploadId, cfg, user);
  }

  @Get('import/jobs/:id')
  @ApiOperation({ summary: 'Andamento da importação (linhas gravadas, % do arquivo, resultado)' })
  importStatus(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: string) {
    return this.layers.importStatus(id, user);
  }

  @Delete('import/jobs/:id')
  @ApiOperation({ summary: 'Cancela a importação (a tabela criada é apagada)' })
  cancelImport(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: string) {
    return this.layers.cancelImport(id, user);
  }

  @Post('copy')
  @ApiOperation({
    summary:
      'Copia os registros selecionados para uma nova tabela (padrão: schema GeoAnalisysTemp)',
  })
  copy(@Body() dto: CopyToLayerDto, @CurrentUser() user: string) {
    return this.layers.copyToLayer(dto.sourceId, dto.ids, dto.name, dto.schema, user);
  }

  @Get(':sourceId/convert-coordinates')
  @ApiOperation({
    summary: 'Colunas que receberão as coordenadas convertidas (lat/lng ↔ UTM) de uma camada',
  })
  conversionPreview(@Param('sourceId') sourceId: string) {
    return this.layers.conversionPreview(sourceId);
  }

  @Post(':sourceId/convert-coordinates')
  @ApiOperation({
    summary:
      'Grava na tabela da camada as coordenadas convertidas (geográfico → UTM X/Y e zona; UTM → latitude/longitude)',
  })
  convertCoordinates(@Param('sourceId') sourceId: string, @CurrentUser() user: string) {
    return this.layers.convertCoordinates(sourceId, user);
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
  exports: [LayersService],
})
export class LayersModule {}
