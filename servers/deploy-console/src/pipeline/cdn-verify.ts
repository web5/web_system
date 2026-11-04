import { createHash } from 'crypto';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

/**
 * CDN 产物校验（verify 阶段，纯逻辑）。
 *
 * 为什么需要「清单对账」而不是逐个 URL 探活：
 * - 逐个 HEAD 只能证明「文件在」，不能证明「内容对」—— 上传 tar 截断、解压冲突、
 *   上一次残留同名文件都是 200 却是错的；
 * - 逐个 GET 算 sha256 在几百个分包时会把 verify 拖成分钟级。
 *
 * 所以：**上传脚本在入口机落一份 `_manifest.sha256`**（`sha256sum` 的输出），
 * verify 只 GET 这一个文件，就能同时拿到「文件集合」与「每文件内容哈希」，
 * 与本地目录递归算出的清单做一次集合比对即完成对账。
 */

/** 清单文件名（入口机由上传脚本生成；本地目录里若存在同名文件视为陈旧产物，递归时排除） */
export const CDN_MANIFEST_FILE = '_manifest.sha256';

/** sha256sum 行：`<64 hex>  <path>` 或 `<64 hex> *<path>`（二进制模式标记） */
const SHA_LINE_RE = /^([0-9a-f]{64})[ \t]+\*?(.+)$/i;

/**
 * 解析 `sha256sum` 输出为 `相对路径 → 哈希`。
 *
 * - 路径统一去掉 `./` 前缀与首尾空白（`sha256sum ./*` 会产出 `./index.js`）；
 * - 反斜杠转义（`sha256sum` 对含 `\` / 换行文件名会加 `\` 前缀）不处理 —— 产物文件名
 *   由 Vite 生成，不会含这些字符；真遇到会因哈希不匹配而失败，属于期望行为；
 * - 非法行忽略；**一条都没解析出来则 throw**（空清单会让所有本地文件报 missing，
 *   但那时错误信息会误导成「文件都没传上去」，不如在这里点明清单本身有问题）。
 */
export function parseSha256Manifest(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = SHA_LINE_RE.exec(line);
    if (!m) continue;
    const file = normalizeRel(m[2]);
    if (!file) continue;
    out.set(file, m[1].toLowerCase());
  }
  if (!out.size) {
    throw new Error(`CDN 清单解析为空（${CDN_MANIFEST_FILE} 内容不是 sha256sum 格式或文件为空）`);
  }
  return out;
}

/** 归一化相对路径：去 `./`、折叠重复 `/`、转 posix 分隔符 */
export function normalizeRel(p: string): string {
  return (p ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+/, '');
}

/** 单文件 sha256（流式，避免把大分包读进内存） */
export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const rs = fs.createReadStream(file);
    rs.on('error', reject);
    rs.on('data', (chunk) => hash.update(chunk));
    rs.on('end', () => resolve(hash.digest('hex')));
  });
}

export interface LocalManifestOptions {
  /** 排除的相对路径（默认排除清单自身） */
  exclude?: string[];
}

/**
 * 递归计算目录的 `相对路径 → sha256`（posix 分隔符，按路径排序便于比对/打印）。
 *
 * - 跳过符号链接：入口机 `dist` 历史上出现过软链（2026-11-04 静态根漂移事故），
 *   跟随链接会把目录外文件算进清单；
 * - 跳过 `_manifest.sha256` 自身，否则「本地清单」与「远端清单」永远差一项。
 */
export async function buildLocalManifest(
  root: string,
  opts: LocalManifestOptions = {},
): Promise<Map<string, string>> {
  const skip = new Set((opts.exclude ?? [CDN_MANIFEST_FILE]).map(normalizeRel));
  const out = new Map<string, string>();
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      const abs = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        await walk(abs, rel);
        continue;
      }
      if (!e.isFile()) continue;
      if (skip.has(rel)) continue;
      out.set(rel, await sha256File(abs));
    }
  };
  await walk(root, '');
  return out;
}

export interface ManifestDiff {
  ok: boolean;
  /** 本地有、远端清单没有（= 没传上去） */
  missing: string[];
  /** 远端清单有、本地没有（= 传了别的东西 / 清单陈旧） */
  extra: string[];
  /** 两边都有但内容不同（= 传输截断 / 覆盖冲突） */
  mismatch: string[];
}

/** 清单集合比对（纯函数，便于单测；`limit` 控制返回条数，避免日志刷屏） */
export function diffManifests(
  local: Map<string, string>,
  remote: Map<string, string>,
  limit = 5,
): ManifestDiff {
  const missing: string[] = [];
  const extra: string[] = [];
  const mismatch: string[] = [];
  for (const [file, hash] of local) {
    const r = remote.get(file);
    if (r === undefined) missing.push(file);
    else if (r !== hash) mismatch.push(file);
  }
  for (const file of remote.keys()) {
    if (!local.has(file)) extra.push(file);
  }
  const cap = (xs: string[]) => xs.slice(0, Math.max(1, limit));
  return {
    ok: !missing.length && !extra.length && !mismatch.length,
    missing: cap(missing),
    extra: cap(extra),
    mismatch: cap(mismatch),
  };
}

/** 把 diff 转成一句人能读的失败原因（用于 throw / 流水线日志） */
export function describeDiff(d: ManifestDiff, localCount: number, remoteCount: number): string {
  const parts = [`本地 ${localCount} 个文件 / 远端清单 ${remoteCount} 个`];
  if (d.missing.length) parts.push(`未上传: ${d.missing.join(', ')}`);
  if (d.extra.length) parts.push(`远端多出: ${d.extra.join(', ')}`);
  if (d.mismatch.length) parts.push(`内容不一致: ${d.mismatch.join(', ')}`);
  return parts.join('；');
}
