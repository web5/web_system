import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { UserTasteProfileEntity } from './user-taste-profile.entity';
import { UserTasteService } from './user-taste.service';
import { UserTasteController } from './user-taste.controller';

@Module({
  imports: [TypeOrmModule.forFeature([UserTasteProfileEntity]), AuthModule],
  controllers: [UserTasteController],
  providers: [UserTasteService],
  exports: [UserTasteService],
})
export class UserTasteModule {}
