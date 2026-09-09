import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ModelPricing } from './entities/model-pricing.entity';

export interface PricingInput {
  provider: string;
  model: string;
  inputPricePer1k: string | number;
  outputPricePer1k: string | number;
  currency?: string;
}

/** 模型单价 CRUD（Phase2.4）：provider+model 唯一；成本核算读取本表 */
@Injectable()
export class ModelPricingService {
  private readonly logger = new Logger(ModelPricingService.name);

  constructor(
    @InjectRepository(ModelPricing)
    private readonly repo: Repository<ModelPricing>,
  ) {}

  list(): Promise<ModelPricing[]> {
    return this.repo.find({ order: { provider: 'ASC', model: 'ASC' } });
  }

  /** 新建或按 (provider, model) 更新（幂等 upsert） */
  async upsert(input: PricingInput, operator?: string): Promise<ModelPricing> {
    const existing = await this.repo.findOne({
      where: { provider: input.provider, model: input.model },
    });
    const patch = {
      inputPricePer1k: String(input.inputPricePer1k),
      outputPricePer1k: String(input.outputPricePer1k),
      currency: input.currency ?? 'CNY',
      updatedBy: operator ?? null,
    };
    if (existing) {
      Object.assign(existing, patch);
      const saved = await this.repo.save(existing);
      this.logger.log(`更新模型单价: ${input.provider}/${input.model}`);
      return saved;
    }
    const row = this.repo.create({
      provider: input.provider,
      model: input.model,
      ...patch,
    });
    const saved = await this.repo.save(row);
    this.logger.log(`新建模型单价: ${input.provider}/${input.model}`);
    return saved;
  }

  async remove(id: string): Promise<{ ok: boolean }> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`模型单价不存在: ${id}`);
    await this.repo.remove(row);
    return { ok: true };
  }
}
