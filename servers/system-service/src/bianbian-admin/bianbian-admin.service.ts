import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';
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
    sticker: { name: '贴纸', icon: 'star' },
    shape: { name: '形状', icon: 'shape' },
    animal: { name: '动物', icon: 'animal' },
    nature: { name: '自然', icon: 'nature' },
    food: { name: '食物', icon: 'food' },
    transport: { name: '交通', icon: 'transport' },
    face: { name: '表情', icon: 'face' },
    bg: { name: '背景', icon: 'image' },
    background: { name: '背景', icon: 'image' },
  };

  constructor(
    @InjectRepository(BianbianMaterial)
    private readonly materialRepository: Repository<BianbianMaterial>,
  ) {}

  // ========== 分类管理 ==========

  /** 获取所有分类（含各分类下的素材数量，单次 SQL） */
  async getCategories() {
    // 一次性统计所有分类的素材数量
    const counts = await this.materialRepository
      .createQueryBuilder('m')
      .select('m.category', 'category')
      .addSelect('COUNT(*)', 'count')
      .where('m.enabled = :enabled', { enabled: true })
      .groupBy('m.category')
      .getRawMany();

    const countMap: Record<string, number> = {};
    for (const row of counts) {
      countMap[row.category] = parseInt(row.count, 10);
    }

    return Object.entries(this.CATEGORY_META).map(([id, meta]) => ({
      id,
      ...meta,
      count: countMap[id] || 0,
    }));
  }

  // ========== 素材管理 ==========

  /** 素材列表（支持关键词跨字段搜索） */
  async getMaterials(query: MaterialListQuery = {}) {
    const { category, keyword, page = 1, pageSize = 200, enabled } = query;

    if (keyword) {
      // 跨字段 OR 搜索：名称、标签、描述
      const qb = this.materialRepository.createQueryBuilder('m');
      qb.where('(m.name LIKE :kw OR m.tags LIKE :kw OR m.description LIKE :kw)', { kw: `%${keyword}%` });
      if (category && category !== 'all') qb.andWhere('m.category = :cat', { cat: category });
      if (enabled !== undefined) qb.andWhere('m.enabled = :enabled', { enabled });
      qb.orderBy('m.sortOrder', 'ASC').addOrderBy('m.name', 'ASC');
      qb.skip((page - 1) * pageSize).take(pageSize);
      const [list, total] = await qb.getManyAndCount();
      return { list, total, page, pageSize };
    }

    const where: FindOptionsWhere<BianbianMaterial> = {};
    if (category && category !== 'all') where.category = category;
    if (enabled !== undefined) where.enabled = enabled;

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
      icon: dto.icon || this.CATEGORY_META[dto.category]?.icon || 'default',
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

  /** 批量更新排序（事务保护） */
  async batchSort(items: Array<{ id: string; sortOrder: number }>): Promise<void> {
    await this.materialRepository.manager.transaction(async (manager) => {
      for (const item of items) {
        await manager.update(BianbianMaterial, item.id, { sortOrder: item.sortOrder });
      }
    });
  }

  /** 批量启用/禁用 */
  async batchToggleEnabled(ids: string[], enabled: boolean): Promise<number> {
    const result = await this.materialRepository.update(ids, { enabled });
    return result.affected || 0;
  }

  /** 初始化系统默认素材（首次运行时使用） */
  async seedDefaultMaterials(force = false): Promise<number> {
    if (!force) {
      const existing = await this.materialRepository.count();
      if (existing > 0) return 0;
    }

    // 强制模式：删除已有素材，用系统默认素材全覆盖
    if (force) {
      await this.materialRepository.delete({ source: 'system' });
    }

    // SVG 素材目录（独立静态资源路径，与页面路由分离）

    const defaults = [
      // ===== 动物 =====
      ...this.makeSvgMaterials('animal', [
        ['小猫', 'material-animal-1.svg'], ['小狗', 'material-animal-2.svg'],
        ['小鱼', 'material-animal-11.svg'], ['蝴蝶', 'material-animal-12.svg'],
        ['毛毛虫', 'material-animal-16.svg'], ['蚂蚁', 'material-animal-17.svg'],
        ['马', 'material-animal-18.svg'],
      ]),
      // ===== 自然 =====
      ...this.makeSvgMaterials('nature', [
        ['太阳', 'material-nature-1.svg'], ['月亮', 'material-nature-2.svg'],
        ['星星', 'material-nature-3.svg'], ['云朵', 'material-nature-4.svg'],
        ['彩虹', 'material-nature-5.svg'], ['花朵', 'material-nature-6.svg'],
        ['大树', 'material-nature-7.svg'], ['蘑菇', 'material-nature-8.svg'],
        ['叶子', 'material-nature-9.svg'], ['雪花', 'material-nature-10.svg'],
        ['火焰', 'material-nature-11.svg'], ['水滴', 'material-nature-12.svg'],
        ['闪电', 'material-nature-13.svg'], ['旋风', 'material-nature-14.svg'],
      ]),
      // ===== 食物 =====
      ...this.makeSvgMaterials('food', [
        ['蛋糕', 'material-food-1.svg'], ['冰淇淋', 'material-food-2.svg'],
        ['棒棒糖', 'material-food-3.svg'], ['苹果', 'material-food-4.svg'],
        ['饼干', 'material-food-6.svg'], ['披萨', 'material-food-7.svg'],
        ['葡萄', 'material-food-9.svg'], ['柠檬', 'material-food-10.svg'],
        ['樱桃', 'material-food-11.svg'], ['咖啡', 'material-food-12.svg'],
        ['牛奶', 'material-food-13.svg'], ['鸡蛋', 'material-food-14.svg'],
      ]),
      // ===== 交通 =====
      ...this.makeSvgMaterials('transport', [
        ['火箭', 'material-trans-1.svg'], ['飞机', 'material-trans-2.svg'],
        ['汽车', 'material-trans-3.svg'], ['火车', 'material-trans-4.svg'],
        ['轮船', 'material-trans-5.svg'], ['直升机', 'material-trans-7.svg'],
        ['热气球', 'material-trans-8.svg'], ['帆船', 'material-trans-9.svg'],
        ['巴士', 'material-trans-11.svg'],
      ]),
      // ===== 贴纸 =====
      ...this.makeSvgMaterials('sticker', [
        ['礼物', 'material-sticker-1.svg'], ['皇冠', 'material-sticker-2.svg'],
        ['气球', 'material-sticker-3.svg'], ['音符', 'material-sticker-4.svg'],
        ['星星魔法', 'material-sticker-5.svg'], ['奖杯', 'material-sticker-6.svg'],
        ['钻石', 'material-sticker-7.svg'], ['旗帜', 'material-sticker-8.svg'],
        ['星星', 'material-sticker-9.svg'], ['爱心', 'material-sticker-10.svg'],
        ['相机', 'material-sticker-11.svg'], ['书本', 'material-sticker-12.svg'],
        ['钥匙', 'material-sticker-13.svg'], ['放大镜', 'material-sticker-14.svg'],
        ['房屋', 'material-sticker-15.svg'], ['钟表', 'material-sticker-16.svg'],
        ['地球', 'material-sticker-17.svg'], ['魔法', 'material-sticker-19.svg'],
        ['笑脸', 'material-sticker-20.svg'], ['哭脸', 'material-sticker-21.svg'],
        ['惊讶', 'material-sticker-22.svg'], ['开心', 'material-sticker-23.svg'],
        ['眨眼', 'material-sticker-25.svg'], ['帅气', 'material-sticker-27.svg'],
        ['可爱', 'material-sticker-28.svg'], ['电话', 'material-sticker-29.svg'],
        ['邮件', 'material-sticker-30.svg'],
      ]),
      // ===== 形状 =====
      ...this.makeSvgMaterials('shape', [
        ['圆形', 'material-shape-1.svg'], ['方形', 'material-shape-2.svg'],
        ['三角', 'material-shape-3.svg'], ['爱心', 'material-shape-4.svg'],
        ['星形', 'material-shape-5.svg'], ['菱形', 'material-shape-6.svg'],
        ['六边形', 'material-shape-7.svg'], ['五边形', 'material-shape-8.svg'],
        ['箭头上', 'material-shape-9.svg'], ['箭头下', 'material-shape-10.svg'],
        ['箭头左', 'material-shape-11.svg'], ['箭头右', 'material-shape-12.svg'],
        ['十字', 'material-shape-14.svg'],
      ]),
      // ===== 背景 =====
      ...this.makeColorMaterials('background', [
        ['晴天', '#87CEEB'], ['日落', '#FF8C42'],
        ['森林', '#7ED957'], ['粉色', '#FFB6C1'],
        ['紫色', '#DDA0DD'], ['暖白', '#FFF8F0'],
        ['海洋', '#4ECDC4'],
      ]),
    ];

    await this.materialRepository.save(defaults);
    return defaults.length;
  }

  private makeSvgMaterials(cat: string, items: Array<[string, string]>, icon?: string) {
    return items.map(([name, fileName], idx) => ({
      name,
      category: cat,
      content: `/materials/svg/${fileName}`,
      type: 'svg' as const,
      icon: icon || this.CATEGORY_META[cat]?.icon || 'default',
      sortOrder: idx + 1,
      source: 'system',
      tags: `${name},${cat}`,
      description: '',
    }));
  }

  private makeColorMaterials(cat: string, items: Array<[string, string]>) {
    return items.map(([name, color], idx) => ({
      name, category: cat, content: color, type: 'color' as const,
      icon: this.CATEGORY_META[cat]?.icon || 'image',
      sortOrder: idx + 1, source: 'system', tags: `${name},颜色,${cat}`,
      description: '',
    }));
  }
}
