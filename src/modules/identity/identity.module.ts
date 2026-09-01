import { Module } from '@nestjs/common';

import { UserPersonMatchingService } from '../../application/use-cases/identity/user-person-matching.service';
import { IdentityController } from './identity.controller';

@Module({
  controllers: [IdentityController],
  providers: [UserPersonMatchingService],
})
export class IdentityModule {}
