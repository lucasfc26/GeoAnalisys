import { Module } from '@nestjs/common';
import { DuplicatesController } from './duplicates.controller';
import { DuplicatesService } from './duplicates.service';

@Module({
  controllers: [DuplicatesController],
  providers: [DuplicatesService],
})
export class DuplicatesModule {}
