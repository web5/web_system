import { Module } from '@nestjs/common';
import { UserMemoryModule } from '../memory/user-memory.module';
import { UserTasteModule } from '../user-taste/user-taste.module';
import { InternalController } from './internal.controller';
import { ServiceKeyGuard } from './service-key.guard';

@Module({
  imports: [UserMemoryModule, UserTasteModule],
  controllers: [InternalController],
  providers: [ServiceKeyGuard],
})
export class InternalModule {}
