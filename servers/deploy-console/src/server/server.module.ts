import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployServerEntity } from '../entities/deploy-server.entity';
import { DeployEnvServiceRouteEntity } from '../entities/deploy-env-service-route.entity';
import { EnvironmentModule } from '../environment/environment.module';
import { ModuleRegistryModule } from '../module-registry/module-registry.module';
import { ServerService } from './server.service';
import { ServerController, EnvServiceRouteController } from './server.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([DeployServerEntity, DeployEnvServiceRouteEntity]),
    EnvironmentModule,
    ModuleRegistryModule,
  ],
  providers: [ServerService],
  controllers: [ServerController, EnvServiceRouteController],
  exports: [ServerService],
})
export class ServerModule {}
