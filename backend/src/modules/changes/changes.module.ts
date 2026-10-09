import { Controller, Delete, Get, Global, Module, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ChangesService } from './changes.service';

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
