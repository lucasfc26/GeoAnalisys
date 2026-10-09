import { Module } from '@nestjs/common';
import { ExportController } from './export.controller';
import { ExportTemplatesService } from './export-templates.service';
import { ExportService } from './export.service';

@Module({
  controllers: [ExportController],
  providers: [ExportService, ExportTemplatesService],
})
export class ExportModule {}
