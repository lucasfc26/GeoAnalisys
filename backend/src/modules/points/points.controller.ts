import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../common/current-user.decorator';
import { parseFilters } from '../../common/filters';
import { sendJson } from '../../common/send-json';
import { SelectionService } from '../selection/selection.service';
import {
  AtQueryDto,
  BboxQueryDto,
  BulkDeleteDto,
  BulkUpdateDto,
  CreatePointDto,
  FilteredQueryDto,
  IdsDto,
  LabelPreviewDto,
  LayerQueryDto,
  ListQueryDto,
  LookupDto,
  QueryDto,
  RecordsDto,
  SearchQueryDto,
  SelectionDto,
  SummaryDto,
  TranslateDto,
  UpdatePointDto,
} from './dto/points.dto';
import { PointsService } from './points.service';

@ApiTags('points')
@Controller('points')
export class PointsController {
  constructor(
    private readonly points: PointsService,
    private readonly selection: SelectionService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lista paginada de registros (com filtros)' })
  list(@Query() q: ListQueryDto) {
    return this.points.list(q.sourceId, parseFilters(q.filters), q.page ?? 1, q.pageSize ?? 50);
  }

  @Get('bbox')
  @ApiOperation({
    summary: 'Pontos visíveis no viewport (agrupados por coordenada ou em clusters)',
  })
  bbox(@Query() q: BboxQueryDto) {
    return this.points.mapPoints(
      q.sourceId,
      { minLat: q.minLat, maxLat: q.maxLat, minLng: q.minLng, maxLng: q.maxLng },
      parseFilters(q.filters),
      q.limit,
      { styleColumn: q.styleColumn, label: q.label },
    );
  }

  @Get('layer')
  @ApiOperation({
    summary: 'Camada inteira (ID, posição, categoria e rótulo) em formato compacto para cache',
  })
  async layer(@Query() q: LayerQueryDto, @Req() req: Request, @Res() res: Response) {
    const data = await this.points.layer(q.sourceId, parseFilters(q.filters), {
      styleColumn: q.styleColumn,
      label: q.label,
      version: q.version,
    });
    await sendJson(req, res, data);
  }

  @Get('label-preview')
  @ApiOperation({ summary: 'Prévia dos rótulos gerados por uma expressão' })
  labelPreview(@Query() q: LabelPreviewDto) {
    return this.points.labelPreview(q.sourceId, q.label);
  }

  @Get('extent')
  extent(@Query() q: FilteredQueryDto) {
    return this.points.extent(q.sourceId, parseFilters(q.filters));
  }

  @Get('at')
  @ApiOperation({ summary: 'Registros em uma coordenada exata (pontos sobrepostos)' })
  at(@Query() q: AtQueryDto) {
    return this.points.at(q.sourceId, q.x, q.y, parseFilters(q.filters), q.idsOnly);
  }

  @Get('search')
  search(@Query() q: SearchQueryDto) {
    return this.points.search(q.sourceId, q.q);
  }

  @Post('selection')
  @ApiOperation({ summary: 'Seleciona registros dentro de um polígono/retângulo' })
  select(@Body() dto: SelectionDto) {
    return this.selection.byPolygon(dto.sourceId, dto.polygon, parseFilters(dto.filters));
  }

  @Post('query')
  @ApiOperation({
    summary: 'Registros que atendem aos filtros, agrupados por coordenada (selecionar por valor)',
  })
  query(@Body() dto: QueryDto) {
    return this.points.byFilters(dto.sourceId, parseFilters(dto.filters));
  }

  @Post('lookup')
  @ApiOperation({
    summary: 'Localiza registros por uma lista de valores de uma coluna (modo lista)',
  })
  lookup(@Body() dto: LookupDto) {
    return this.points.lookup(dto.sourceId, dto.column, dto.values);
  }

  @Post('records')
  @ApiOperation({ summary: 'Registros por lista de IDs (lazy loading da lista do painel)' })
  records(@Body() dto: RecordsDto) {
    return this.points.records(dto.sourceId, dto.ids, dto.full);
  }

  @Post('summary')
  summary(@Body() dto: SummaryDto) {
    return this.points.summary(
      dto.sourceId,
      dto.ids,
      dto.columns?.length ? dto.columns : dto.column,
    );
  }

  @Patch('bulk')
  @ApiOperation({ summary: 'Edição em massa (transação)' })
  bulkUpdate(@Body() dto: BulkUpdateDto, @CurrentUser() user: string) {
    return this.points.bulkUpdate(dto.sourceId, dto.ids, dto.changes, user);
  }

  @Post('translate')
  @ApiOperation({ summary: 'Move ou duplica registros com um deslocamento (transação)' })
  translate(@Body() dto: TranslateDto, @CurrentUser() user: string) {
    return this.points.translate(
      dto.sourceId,
      dto.ids,
      dto.mode,
      dto.from,
      dto.to,
      user,
      dto.observation,
    );
  }

  @Delete('bulk')
  @ApiOperation({ summary: 'Exclusão em massa (transação)' })
  bulkDelete(@Body() dto: BulkDeleteDto, @CurrentUser() user: string) {
    return this.points.bulkDelete(dto.sourceId, dto.ids, user, dto.observation);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Query('sourceId', ParseUUIDPipe) sourceId: string) {
    return this.points.findOne(sourceId, id);
  }

  @Post()
  create(@Body() dto: CreatePointDto, @CurrentUser() user: string) {
    return this.points.create(dto, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePointDto, @CurrentUser() user: string) {
    return this.points.update(dto.sourceId, id, dto.data, user);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Query('sourceId', ParseUUIDPipe) sourceId: string,
    @CurrentUser() user: string,
    @Query('observation') observation?: string,
  ) {
    return this.points.remove(sourceId, id, user, observation?.slice(0, 500));
  }
}
