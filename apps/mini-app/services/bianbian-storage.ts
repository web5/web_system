/**
 * 变变 — 本地存储服务
 * 草稿自动保存 / 历史记录管理 / 每日额度
 */

import type { Draft, TransformResult } from '../utils/bianbian-constants';
import { STORAGE_KEYS, MAX_HISTORY, DAILY_TRANSFORM_LIMIT } from '../utils/bianbian-constants';

function now(): number {
  return Date.now();
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// ========== 草稿 ==========

export function saveDraft(draft: Draft): void {
  try {
    wx.setStorageSync(STORAGE_KEYS.draft, { ...draft, updatedAt: now() });
  } catch {
    console.warn('[变变] 保存草稿失败');
  }
}

export function loadDraft(): Draft | null {
  try {
    const draft = wx.getStorageSync(STORAGE_KEYS.draft);
    if (!draft) return null;
    // 24小时过期
    if (now() - draft.updatedAt > 24 * 60 * 60 * 1000) {
      clearDraft();
      return null;
    }
    return draft as Draft;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    wx.removeStorageSync(STORAGE_KEYS.draft);
  } catch {
    // 静默失败
  }
}

export function hasRecentDraft(): boolean {
  const draft = loadDraft();
  return draft !== null && draft.elements.length > 0;
}

// ========== 历史记录 ==========

export function getHistory(): TransformResult[] {
  try {
    const arr = wx.getStorageSync(STORAGE_KEYS.history);
    return Array.isArray(arr) ? (arr as TransformResult[]) : [];
  } catch {
    return [];
  }
}

export function saveHistoryItem(item: TransformResult): void {
  try {
    const history = getHistory();
    history.unshift(item);
    // 超出上限时移除最早的
    if (history.length > MAX_HISTORY) {
      history.length = MAX_HISTORY;
    }
    wx.setStorageSync(STORAGE_KEYS.history, history);
  } catch {
    console.warn('[变变] 保存历史记录失败');
  }
}

export function deleteHistoryItem(id: string): void {
  try {
    const history = getHistory().filter((item) => item.id !== id);
    wx.setStorageSync(STORAGE_KEYS.history, history);
  } catch {
    // 静默失败
  }
}

export function deleteHistoryBatch(ids: string[]): void {
  try {
    const idSet = new Set(ids);
    const history = getHistory().filter((item) => !idSet.has(item.id));
    wx.setStorageSync(STORAGE_KEYS.history, history);
  } catch {
    // 静默失败
  }
}

// ========== 每日变变次数 ==========

export function getDailyTransformCount(): number {
  try {
    const data = wx.getStorageSync(STORAGE_KEYS.dailyCount);
    if (data && data.date === todayKey()) {
      return data.count as number;
    }
    return 0;
  } catch {
    return 0;
  }
}

export function incrementDailyTransformCount(): void {
  try {
    const key = todayKey();
    const current = getDailyTransformCount();
    wx.setStorageSync(STORAGE_KEYS.dailyCount, { date: key, count: current + 1 });
  } catch {
    // 静默失败
  }
}

export function canTransformToday(): boolean {
  return getDailyTransformCount() < DAILY_TRANSFORM_LIMIT;
}
