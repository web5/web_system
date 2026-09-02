/**
 * Admin - 技能库（Skills）
 * 后端：ai-service
 * 接口前缀：/api/admin/skills
 */
import request from './request';

export interface SkillItem {
  id: number;
  code: string;
  name: string;
  description: string;
  version: string;
  requiredTools: string[] | null;
  enabled: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SkillDetail extends SkillItem {
  content: string;
}

export interface SaveSkillPayload {
  code: string;
  name: string;
  description: string;
  version?: string;
  content: string;
  requiredTools?: string[];
  enabled?: boolean;
}

/** 技能列表 */
export function listSkills(): Promise<SkillItem[]> {
  return request.get('/admin/skills');
}

/** 技能详情（含正文） */
export function getSkill(code: string): Promise<SkillDetail> {
  return request.get(`/admin/skills/${code}`);
}

/** 新建技能 */
export function createSkill(payload: SaveSkillPayload): Promise<SkillDetail> {
  return request.post('/admin/skills', payload);
}

/** 编辑技能（全量覆盖） */
export function updateSkill(code: string, payload: SaveSkillPayload): Promise<SkillDetail> {
  return request.put(`/admin/skills/${code}`, payload);
}

/** 删除技能 */
export function removeSkill(code: string): Promise<{ ok: boolean }> {
  return request.delete(`/admin/skills/${code}`);
}

/** zip 技能包导入 */
export function importSkillZip(file: File): Promise<SkillDetail> {
  const formData = new FormData();
  formData.append('file', file);
  return request.post('/admin/skills/import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}
