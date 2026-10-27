import { Module } from '@nestjs/common';
import { LayersModule } from '../layers/layers.module';
import { PointsModule } from '../points/points.module';
import { AssociationController } from './association.controller';
import { AssociationService } from './association.service';

@Module({
  imports: [LayersModule, PointsModule],
  controllers: [AssociationController],
  providers: [AssociationService],
})
export class AssociationModule {}
