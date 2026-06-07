// drawing-records.ts - 绘画记录本地存储服务
// 后续可扩展为云端存储

export interface DrawingRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** 缩略图临时文件路径 */
  thumbnail?: string;
  /** 画布内容 base64 data URL（用于恢复绘制内容） */
  canvasData?: string;
}

const STORAGE_KEY = 'drawing_records';
const MAX_RECORDS = 50;

/** 生成唯一 ID */
function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 获取所有记录（按更新时间倒序） */
export function getRecords(): DrawingRecord[] {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY);
    if (Array.isArray(raw)) return raw;
    return [];
  } catch (_) {
    return [];
  }
}

/** 保存记录列表 */
function saveRecords(records: DrawingRecord[]): void {
  try {
    wx.setStorageSync(STORAGE_KEY, records);
  } catch (e) {
    console.error('[DrawingRecords] 保存失败', e);
  }
}

/** 生成默认名称 "未命名 N" */
export function generateDefaultName(): string {
  const records = getRecords();
  // 从已有记录名中提取最大序号
  let maxN = 0;
  for (const r of records) {
    const match = r.name.match(/^未命名\s*(\d+)$/);
    if (match) {
      maxN = Math.max(maxN, parseInt(match[1], 10));
    }
  }
  return `未命名 ${maxN + 1}`;
}

/** 创建新记录 */
export function createRecord(): DrawingRecord {
  const record: DrawingRecord = {
    id: generateId(),
    name: generateDefaultName(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const records = getRecords();
  records.unshift(record);
  // 限制最大记录数
  if (records.length > MAX_RECORDS) {
    records.length = MAX_RECORDS;
  }
  saveRecords(records);
  return record;
}

/** 更新记录 */
export function updateRecord(
  id: string,
  updates: Partial<Omit<DrawingRecord, 'id' | 'createdAt'>>,
): void {
  const records = getRecords();
  const idx = records.findIndex(r => r.id === id);
  if (idx === -1) return;
  records[idx] = { ...records[idx], ...updates, updatedAt: Date.now() };
  // 更新后置顶
  const [updated] = records.splice(idx, 1);
  records.unshift(updated);
  saveRecords(records);
}

/** 删除记录 */
export function deleteRecord(id: string): void {
  const records = getRecords();
  const filtered = records.filter(r => r.id !== id);
  saveRecords(filtered);
}

/** 获取单条记录 */
export function getRecord(id: string): DrawingRecord | undefined {
  return getRecords().find(r => r.id === id);
}
