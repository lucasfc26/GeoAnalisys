import {
  Body,
  Controller,
  Module,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { CurrentUser } from '../../common/current-user.decorator';
import type { Upload } from '../layers/layers.service';
import { MAX_IDS } from '../points/dto/points.dto';
import { PointsModule } from '../points/points.module';
import { ChangeActionsService } from './change-actions.service';
import { ChangesService } from './changes.service';

const MAX_FILE = 50 * 1024 * 1024;
const upload = FileInterceptor('file', { limits: { fileSize: MAX_FILE } });

/** Ids das linhas da Tabela de Alterações. */
class ChangeIdsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_IDS)
  @Matches(/^\d+$/, { each: true })
  ids: string[];
}

class ChangeObservationDto extends ChangeIdsDto {
  @IsString()
  @MaxLength(2000)
  observation: string;

  /** Acrescenta à observação existente em vez de substituir */
  @IsOptional()
  @IsBoolean()
  append?: boolean;
}

class EditChangeDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  observation?: string | null;

  /** Atributo → valor novo, gravado no ponto */
  @IsOptional()
  @IsObject()
  values?: Record<string, unknown>;
}

@ApiTags('changes')
@Controller('changes')
class ChangeActionsController {
  constructor(
    private readonly changes: ChangesService,
    private readonly actions: ChangeActionsService,
  ) {}

  @Post('forget')
  @ApiOperation({ summary: 'Limpa linhas da Tabela de Alterações (os pontos não mudam)' })
  forget(@Body() dto: ChangeIdsDto) {
    return this.changes.forgetRows(dto.ids);
  }

  @Post('rollback')
  @ApiOperation({
    summary:
      'Volta os pontos ao estado original (alterado → valores antigos, adicionado → removido, removido → restaurado)',
  })
  rollback(@Body() dto: ChangeIdsDto, @CurrentUser() user: string) {
    return this.actions.rollback(dto.ids, user);
  }

  @Post('observation')
  @ApiOperation({ summary: 'Troca ou acrescenta a observação das linhas' })
  observation(@Body() dto: ChangeObservationDto) {
    return this.changes.setObservation(dto.ids, dto.observation, !!dto.append);
  }

  @Post('import')
  @UseInterceptors(upload)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Importa alterações de XLSX/XLSM/CSV (Tabela, ID, Observacao, Atributos Alterados, Valores Novos) e grava nos pontos',
  })
  import(@UploadedFile() file: Upload | undefined, @CurrentUser() user: string) {
    return this.actions.import(file, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edita uma linha: valores novos (gravados no ponto) e observação' })
  edit(@Param('id') id: string, @Body() dto: EditChangeDto, @CurrentUser() user: string) {
    return this.actions.edit(id, dto, user);
  }
}

@Module({
  imports: [PointsModule],
  controllers: [ChangeActionsController],
  providers: [ChangeActionsService],
})
export class ChangeActionsModule {}
