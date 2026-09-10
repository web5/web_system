import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DictType } from './dict-type.entity';
import { DictField } from './dict-field.entity';
import { DictItem } from './dict-item.entity';
import { DictService } from './dict.service';
import { DictController } from './dict.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DictType, DictField, DictItem])],
  providers: [DictService],
  controllers: [DictController],
  exports: [DictService],
})
export class DictModule {}
