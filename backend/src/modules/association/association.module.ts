import { Module } from '@nestjs/common';
import { LayersModule } from '../layers/layers.module';
import { AssociationController } from './association.controller';
import { AssociationService } from './association.service';

@Module({
  imports: [LayersModule],
  controllers: [AssociationController],
  providers: [AssociationService],
})
export class AssociationModule {}
