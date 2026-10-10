import { Module } from '@nestjs/common';
import { AssociationController } from './association.controller';
import { AssociationService } from './association.service';

@Module({
  controllers: [AssociationController],
  providers: [AssociationService],
})
export class AssociationModule {}
