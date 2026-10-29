/**
 * 用户「新增 / 编辑」表单 → 后端 DTO 载荷的纯转换函数。
 *
 * 背景（2026-10-29 事故）：编辑弹窗曾用 Object.assign(formData, record) 把表格
 * 整行记录（id、createdAt、updatedAt、deletedAt、enabled、mpOpenid、oaOpenid、
 * mergedTo、systems…）拷进表单，提交时整包发给 PUT /users/:id。user-service 的
 * 全局 ValidationPipe 是 `whitelist + forbidNonWhitelisted`（2026-06-11 fadc159a 起），
 * 每个多余字段都会报一条「property X should not exist」→ 400，编辑用户从未真正保存成功过。
 *
 * 另有两个连带的静默坑，这里一并处理：
 *  1. 表单用 enabled 布尔开关，后端 UpdateUserDto 只认 status('active'|'inactive'|'banned')
 *     —— 之前直接把 enabled 发出去，同样命中 whitelist 报错；
 *  2. email / phone 的**空串不能发**：IsEmail 会拒绝空串；phone 空串会撞
 *     uk_users_phone 唯一索引（多行空串互相冲突）直接 500 —— 留空就整体不发，
 *     后端 IsOptional 跳过，保持原值不动。
 *
 * 创建与编辑的 DTO 面不同，用 isCreate 区分：
 *  - create：必发 password（CreateUserDto @ApiProperty 必填，minLength 6）；
 *    **不发 status**（CreateUserDto 没这个字段，发了即 whitelist 报错）。
 *  - update：不发 password（编辑弹窗不提供改密，避免半途改语义）；发 status。
 */

export interface UserFormInput {
  username?: string;
  nickname?: string;
  email?: string;
  phone?: string;
  /** 表单的角色单选（后端要的是 roles 数组） */
  role?: string;
  /** 表单的启用开关 */
  enabled?: boolean;
  password?: string;
}

export interface UserPayload {
  username: string;
  nickname?: string;
  email?: string;
  phone?: string;
  roles: string[];
  status?: 'active' | 'inactive' | 'banned';
  password?: string;
}

/** 去空白；空串返回 undefined（= 整个字段不发，后端 IsOptional 保持原值） */
function trimOrOmit(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s ? s : undefined;
}

export function buildUserPayload(
  form: UserFormInput,
  opts: { isCreate: boolean },
): UserPayload {
  const username = trimOrOmit(form.username) ?? '';
  const role = trimOrOmit(form.role) ?? 'user';

  const payload: UserPayload = {
    username,
    roles: [role],
  };

  const nickname = trimOrOmit(form.nickname);
  if (nickname !== undefined) payload.nickname = nickname;
  const email = trimOrOmit(form.email);
  if (email !== undefined) payload.email = email;
  const phone = trimOrOmit(form.phone);
  if (phone !== undefined) payload.phone = phone;

  if (opts.isCreate) {
    // CreateUserDto 必填 password；没有 status 字段
    payload.password = typeof form.password === 'string' ? form.password : '';
  } else if (form.enabled !== undefined) {
    payload.status = form.enabled ? 'active' : 'inactive';
  }

  return payload;
}
