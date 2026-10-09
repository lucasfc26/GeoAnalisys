import { Global, Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { SourcesService } from './sources.service';
import { DatabaseController, TablesController } from './tables.controller';

@Global()
@Module({
  controllers: [DatabaseController, TablesController],
  providers: [CatalogService, SourcesService],
  exports: [CatalogService, SourcesService],
})
export class TablesModule {}
