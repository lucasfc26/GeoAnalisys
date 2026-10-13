import { Module } from '@nestjs/common';
import { ComparisonController } from './comparison.controller';
import { ComparisonService } from './comparison.service';

@Module({
  controllers: [ComparisonController],
  providers: [ComparisonService],
})
export class ComparisonModule {}
