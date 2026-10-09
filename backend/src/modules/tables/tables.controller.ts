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
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/current-user.decorator';
import { CatalogService } from './catalog.service';
import { SourceConfigDto, UpdateSourceDto } from './dto/source.dto';
import { SourcesService } from './sources.service';

/** Descoberta da estrutura do banco local. */
@ApiTags('database')
@Controller('database')
export class DatabaseController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('info')
  info() {
    return this.catalog.info();
  }

  @Get('databases')
  databases() {
    return this.catalog.listDatabases();
  }

  @Get('schemas')
  schemas() {
    return this.catalog.listSchemas();
  }

  @Get('tables')
  @ApiQuery({ name: 'schema', example: 'public' })
  tables(@Query('schema') schema = 'public') {
    return this.catalog.listTables(schema);
  }

  @Get('columns')
  columns(@Query('schema') schema: string, @Query('table') table: string) {
    return this.catalog.getColumns(schema, table, true);
  }
}

/** Fontes de dados (tabelas configuradas com colunas UTM e CRS). */
@ApiTags('tables')
@Controller('tables')
export class TablesController {
  constructor(private readonly sources: SourcesService) {}

  @Get()
  list() {
    return this.sources.list();
  }

  @Post()
  create(@Body() dto: SourceConfigDto, @CurrentUser() user: string) {
    return this.sources.create(dto, user);
  }

  @Post('test')
  @ApiOperation({ summary: 'Testa uma configuração sem salvar (contagem, extensão, avisos e prévia)' })
  test(@Body() dto: SourceConfigDto) {
    return this.sources.test(dto);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.sources.get(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSourceDto, @CurrentUser() user: string) {
    return this.sources.update(id, dto, user);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: string) {
    return this.sources.remove(id, user);
  }

  @Get(':id/schema')
  schema(@Param('id', ParseUUIDPipe) id: string) {
    return this.sources.schema(id);
  }

  @Get(':id/preview')
  preview(@Param('id', ParseUUIDPipe) id: string, @Query('limit') limit?: string) {
    return this.sources.preview(id, limit ? Number(limit) : 20);
  }

  @Post(':id/test')
  async testSaved(@Param('id', ParseUUIDPipe) id: string) {
    const s = await this.sources.get(id);
    return this.sources.test(s);
  }

  @Get(':id/distinct')
  distinct(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('column') column: string,
    @Query('search') search?: string,
  ) {
    return this.sources.distinct(id, column, search);
  }

  @Get(':id/indexes')
  async indexes(@Param('id', ParseUUIDPipe) id: string) {
    const ctx = await this.sources.context(id);
    return this.sources.coordinateIndexStatus(ctx);
  }

  @Post(':id/indexes')
  @ApiOperation({ summary: 'Cria índices em X/Y e ID na tabela de origem' })
  createIndexes(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: string) {
    return this.sources.createIndexes(id, user);
  }
}
