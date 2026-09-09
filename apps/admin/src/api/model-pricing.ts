/**
 * Admin - 模型单价配置（P2·D6.2 模型单价行）
 *
 * 后端：ai-service `admin/model-pricing`（gateway `/api/admin/model-pricing` → ai-service）
 * 权限：agents:cost:view（成本/单价为商务信息，仅 admin+）
 */
import request from './request';

export interface ModelPricingItem {
  id: string;
  provider: string;
  model: string;
  inputPricePer1k: string;
  outputPricePer1k: string;
  currency: string;
  updatedBy: string | null;
  updatedAt: string;
}

export interface PricingForm {
  provider: string;
  model: string;
  inputPricePer1k: string | number;
  outputPricePer1k: string | number;
  currency?: string;
}

export async function fetchPricings(): Promise<ModelPricingItem[]> {
  const res: unknown = await request.get('/admin/model-pricing');
  const list = Array.isArray(res) ? res : (res as { data?: unknown } | null)?.data ?? [];
  return (Array.isArray(list) ? list : []) as ModelPricingItem[];
}

export async function upsertPricing(body: PricingForm): Promise<ModelPricingItem> {
  const res: unknown = await request.post('/admin/model-pricing', body);
  return (Array.isArray(res) ? undefined : res) as ModelPricingItem;
}

export async function removePricing(id: string): Promise<{ ok: boolean }> {
  return (await request.delete(`/admin/model-pricing/${id}`)) as { ok: boolean };
}
