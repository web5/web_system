import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Artwork } from './entities/artwork.entity';
import { ArtworksService } from './artworks.service';
import { ArtworksController } from './artworks.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Artwork])],
  controllers: [ArtworksController],
  providers: [ArtworksService],
  exports: [ArtworksService],
})
export class ArtworksModule {}
