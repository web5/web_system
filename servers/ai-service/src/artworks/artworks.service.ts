import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Artwork } from './entities/artwork.entity';
import { SaveArtworkDto } from './dto/save-artwork.dto';
import { BusinessException } from '../common/exceptions/business.exception';

@Injectable()
export class ArtworksService {
  constructor(
    @InjectRepository(Artwork)
    private readonly artworkRepository: Repository<Artwork>,
  ) {}

  /**
   * 保存作品到用户相册
   */
  async save(dto: SaveArtworkDto): Promise<Artwork> {
    const artwork = this.artworkRepository.create(dto);
    return this.artworkRepository.save(artwork);
  }

  /**
   * 查询用户的作品列表（按创建时间倒序）
   */
  async findByUser(userId: number): Promise<Artwork[]> {
    return this.artworkRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * 删除指定作品，仅允许删除自己的作品
   */
  async delete(userId: number, id: string): Promise<void> {
    const result = await this.artworkRepository.delete({ id, userId });
    if (result.affected === 0) {
      throw new BusinessException('作品不存在或无权限删除', 4004);
    }
  }
}
