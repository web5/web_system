import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DictType } from './dict-type.entity';
import { DictField } from './dict-field.entity';
import { DictItem } from './dict-item.entity';
import { DictService } from './dict.service';
import { DictController } from './dict.controller';
import { InternalDictController } from './internal-dict.controller';
import { PublicDictController } from './public-dict.controller';
import { InternalGuard } from '../auth/internal.guard';

@Module({
  imports: [TypeOrmModule.forFeature([DictType, DictField, DictItem])],
  providers: [DictService, InternalGuard],
  controllers: [DictController, InternalDictController, PublicDictController],
  exports: [DictService],
})
export class DictModule {}
