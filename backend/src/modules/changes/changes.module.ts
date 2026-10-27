import { Body, Controller, Delete, Get, Global, Module, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  Matches,
} from 'class-validator';
import type { Response } from 'express';
import { MAX_IDS } from '../points/dto/points.dto';
import { ChangesService } from './changes.service';

class ChangeXlsxDto {
  /** Só essas linhas; ausente = todas */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_IDS)
  @Matches(/^\d+$/, { each: true })
  ids?: string[];
  /** Preenche os atributos das colunas do arquivo que o ponto não alterou */
  @IsOptional() @IsBoolean() fill?: boolean;
}

@ApiTags('changes')
@Controller('changes')
class ChangesController {
  constructor(private readonly changes: ChangesService) {}

  @Get()
  @ApiOperation({ summary: 'Tabela de Alterações (pontos adicionados, removidos e alterados)' })
  list() {
    return this.changes.list();
  }

  @Get('xlsx')
  @ApiOperation({ summary: 'Tabela de Alterações em XLSX (uma coluna "old"/"new" por atributo)' })
  async xlsx(@Res() res: Response) {
    await this.changes.exportXlsx(res);
  }

  @Post('xlsx')
  @ApiOperation({
    summary:
      'Tabela de Alterações em XLSX: só as linhas escolhidas e/ou com os valores não alterados preenchidos',
  })
  async xlsxOf(@Body() dto: ChangeXlsxDto, @Res() res: Response) {
    await this.changes.exportXlsx(res, dto.ids, dto.fill ?? false);
  }

  @Delete()
  @ApiOperation({ summary: 'Limpa a Tabela de Alterações' })
  clear() {
    return this.changes.clear();
  }
}

@Global()
@Module({
  controllers: [ChangesController],
  providers: [ChangesService],
  exports: [ChangesService],
})
export class ChangesModule {}
