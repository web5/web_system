import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { UserMemoryEntity } from './user-memory.entity';
import { UserMemoryService } from './user-memory.service';
import { UserMemoryController } from './user-memory.controller';

@Module({
  imports: [TypeOrmModule.forFeature([UserMemoryEntity]), AuthModule],
  controllers: [UserMemoryController],
  providers: [UserMemoryService],
  exports: [UserMemoryService],
})
export class UserMemoryModule {}
