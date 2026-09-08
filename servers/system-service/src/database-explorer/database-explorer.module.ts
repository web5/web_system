import { Module } from '@nestjs/common';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';
import { DatabaseExplorerController } from './database-explorer.controller';
import { DatabaseExplorerService } from './database-explorer.service';

@Module({
  imports: [OperationLogsModule],
  controllers: [DatabaseExplorerController],
  providers: [DatabaseExplorerService],
})
export class DatabaseExplorerModule {}
