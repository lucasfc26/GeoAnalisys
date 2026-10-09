import { Module } from '@nestjs/common';
import { SelectionService } from '../selection/selection.service';
import { PointsController } from './points.controller';
import { PointsService } from './points.service';

@Module({
  controllers: [PointsController],
  providers: [PointsService, SelectionService],
  exports: [PointsService],
})
export class PointsModule {}
