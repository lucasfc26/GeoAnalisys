import { Global, Module } from '@nestjs/common';
import { CrsService } from './crs.service';
import { MapsController } from './maps.controller';

@Global()
@Module({
  controllers: [MapsController],
  providers: [CrsService],
  exports: [CrsService],
})
export class MapsModule {}
