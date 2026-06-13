import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemConfig } from '../config/system-config.entity';

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(SystemConfig)
    private repo: Repository<SystemConfig>,
  ) {}

  async getAll(): Promise<Record<string, string>> {
    const rows = await this.repo.find();
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  async get(key: string): Promise<string | null> {
    const row = await this.repo.findOneBy({ key });
    return row?.value ?? null;
  }

  async getBoolean(key: string, defaultValue = false): Promise<boolean> {
    const v = await this.get(key);
    if (v === null) return defaultValue;
    return v === '1' || v === 'true';
  }

  async getNumber(key: string, defaultValue = 0): Promise<number> {
    const v = await this.get(key);
    if (v === null) return defaultValue;
    return parseInt(v, 10) || defaultValue;
  }

  async set(key: string, value: string): Promise<void> {
    await this.repo.upsert({ key, value }, ['key']);
  }

  async setBoolean(key: string, value: boolean): Promise<void> {
    await this.set(key, value ? '1' : '0');
  }

  async setNumber(key: string, value: number): Promise<void> {
    await this.set(key, String(value));
  }

  async batchSet(data: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(data)) {
      await this.set(key, value);
    }
  }
}
