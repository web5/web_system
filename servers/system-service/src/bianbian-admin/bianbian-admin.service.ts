import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { BianbianMaterial } from './entities/bianbian-material.entity';

export interface MaterialListQuery {
  category?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
  enabled?: boolean;
}

export interface MaterialCreateDto {
  name: string;
  category: string;
  content: string;
  tags?: string;
  icon?: string;
  type?: string;
  description?: string;
  sortOrder?: number;
  enabled?: boolean;
}

export interface MaterialUpdateDto {
  name?: string;
  category?: string;
  content?: string;
  tags?: string;
  icon?: string;
  type?: string;
  description?: string;
  sortOrder?: number;
  enabled?: boolean;
}

@Injectable()
export class BianbianAdminService {
  private readonly logger = new Logger(BianbianAdminService.name);

  // 分类元数据（id → { name, icon }）
  private readonly CATEGORY_META: Record<string, { name: string; icon: string }> = {
    sticker: { name: '贴纸', icon: '⭐' },
    shape: { name: '形状', icon: '🔷' },
    animal: { name: '动物', icon: '🐱' },
    nature: { name: '自然', icon: '🌿' },
    face: { name: '表情', icon: '😊' },
    bg: { name: '背景', icon: '🖼️' },
  };

  constructor(
    @InjectRepository(BianbianMaterial)
    private readonly materialRepository: Repository<BianbianMaterial>,
  ) {}

  // ========== 分类管理 ==========

  /** 获取所有分类 （含各分类下的素材数量） */
  async getCategories() {
    const categories = Object.entries(this.CATEGORY_META).map(([id, meta]) => ({
      id,
      ...meta,
    }));

    // 统计每个分类下的素材数
    const countMap: Record<string, number> = {};
    for (const cat of categories) {
      countMap[cat.id] = await this.materialRepository.count({
        where: { category: cat.id, enabled: true },
      });
    }

    return categories.map((cat) => ({
      ...cat,
      count: countMap[cat.id] || 0,
    }));
  }

  // ========== 素材管理 ==========

  /** 素材列表 */
  async getMaterials(query: MaterialListQuery = {}) {
    const { category, keyword, page = 1, pageSize = 200, enabled } = query;
    const where: any = {};

    if (category && category !== 'all') {
      where.category = category;
    }
    if (keyword) {
      // 搜索名称、标签、描述
      where.name = Like(`%${keyword}%`);
    }
    if (enabled !== undefined) {
      where.enabled = enabled;
    }

    const [list, total] = await this.materialRepository.findAndCount({
      where,
      order: { sortOrder: 'ASC', category: 'ASC', name: 'ASC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return { list, total, page, pageSize };
  }

  /** 创建素材 */
  async createMaterial(dto: MaterialCreateDto): Promise<BianbianMaterial> {
    const maxSortResult = await this.materialRepository.findOne({
      where: { category: dto.category },
      order: { sortOrder: 'DESC' },
      select: ['sortOrder'],
    });
    const maxSort = maxSortResult?.sortOrder ?? 0;

    const material = this.materialRepository.create({
      name: dto.name,
      category: dto.category,
      content: dto.content,
      tags: dto.tags || '',
      icon: dto.icon || this.CATEGORY_META[dto.category]?.icon || '📦',
      type: dto.type || 'emoji',
      description: dto.description || '',
      source: 'custom',
      sortOrder: dto.sortOrder ?? (maxSort ?? 0) + 1,
      enabled: dto.enabled !== false,
    });
    return this.materialRepository.save(material);
  }

  /** 更新素材 */
  async updateMaterial(id: string, dto: MaterialUpdateDto): Promise<BianbianMaterial> {
    const material = await this.materialRepository.findOne({ where: { id } });
    if (!material) throw new Error('素材不存在');
    Object.assign(material, dto);
    return this.materialRepository.save(material);
  }

  /** 删除素材 */
  async deleteMaterial(id: string): Promise<void> {
    const result = await this.materialRepository.delete(id);
    if (result.affected === 0) throw new Error('素材不存在');
  }

  /** 批量更新排序 */
  async batchSort(items: Array<{ id: string; sortOrder: number }>): Promise<void> {
    for (const item of items) {
      await this.materialRepository.update(item.id, { sortOrder: item.sortOrder });
    }
  }

  /** 批量启用/禁用 */
  async batchToggleEnabled(ids: string[], enabled: boolean): Promise<number> {
    const result = await this.materialRepository.update(ids, { enabled });
    return result.affected || 0;
  }

  /** 初始化系统默认素材（首次运行时使用） */
  async seedDefaultMaterials(): Promise<number> {
    const existing = await this.materialRepository.count();
    if (existing > 0) return 0;

    const defaults = [
      // 贴纸
      ...this.makeMaterials('sticker', [
        ['星星', '⭐'], ['爱心', '❤️'], ['彩虹', '🌈'],
        ['闪光', '✨'], ['皇冠', '👑'], ['礼物', '🎁'],
        ['火箭', '🚀'], ['音符', '🎵'],
      ]),
      // 形状
      ...this.makeMaterials('shape', [
        ['圆形', '🔴'], ['方形', '🟧'], ['三角', '🔺'],
        ['钻石', '💎'], ['星形', '⭐'],
      ]),
      // 动物
      ...this.makeMaterials('animal', [
        ['小猫', '🐱'], ['小狗', '🐶'], ['兔子', '🐰'],
        ['小熊', '🐻'], ['熊猫', '🐼'], ['狐狸', '🦊'],
        ['独角兽', '🦄'], ['恐龙', '🦖'],
      ]),
      // 自然
      ...this.makeMaterials('nature', [
        ['太阳', '☀️'], ['月亮', '🌙'], ['云朵', '☁️'],
        ['花朵', '🌸'], ['大树', '🌳'], ['蘑菇', '🍄'],
      ]),
      // 表情
      ...this.makeMaterials('face', [
        ['开心', '😊'], ['酷', '😎'], ['眨眼', '😉'],
        ['喜欢', '🥰'], ['大笑', '😂'], ['惊讶', '😲'],
      ]),
      // 背景
      ...this.makeColorMaterials('bg', [
        ['白色', '#FFFFFF'], ['天空蓝', '#87CEEB'],
        ['草地绿', '#7ED957'], ['粉色', '#FFB6C1'],
        ['暖黄', '#FFE4B5'], ['淡紫', '#DDA0DD'],
      ]),
    ];

    await this.materialRepository.save(defaults);
    return defaults.length;
  }

  private makeMaterials(cat: string, items: Array<[string, string]>, icon?: string) {
    return items.map(([name, emoji], idx) => ({
      name, category: cat, content: emoji, type: 'emoji' as const,
      icon: icon || this.CATEGORY_META[cat]?.icon || '📦',
      sortOrder: idx + 1, source: 'system', tags: `${name},${cat}`,
      description: '',
    }));
  }

  private makeColorMaterials(cat: string, items: Array<[string, string]>) {
    return items.map(([name, color], idx) => ({
      name, category: cat, content: color, type: 'color' as const,
      icon: this.CATEGORY_META[cat]?.icon || '🖼️',
      sortOrder: idx + 1, source: 'system', tags: `${name},颜色,${cat}`,
      description: '',
    }));
  }
}
