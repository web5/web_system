/**
 * 事实采集的**输出解析**（纯函数，不碰 IO，便于单测）。
 *
 * 全部按"解析失败返回 null / 空数组"处理：**采不到 ≠ 一致**，
 * 由上层按「有期望没实际」判 `missing`，绝不因为解析不出东西就当 ok。
 */

/** pm2 进程的安全字段（**不得**带 pm2_env 全量：里面是进程环境变量） */
export interface Pm2ProcessFact {
  name: string;
  pid: number | null;
  status: string | null;
  cwd: string | null;
  restarts: number | null;
}

/** 从 env 层入口指针里取真实版本（commit 短哈希） */
export function parsePointerCommit(indexJs: string): string | null {
  if (!indexJs) return null;
  // 形如：System.register(['./5ba74517/index.js'], ...)
  const m = indexJs.match(/['"]?\.\/([A-Za-z0-9._-]{6,64})\/index\.js['"]?/);
  return m ? m[1] : null;
}

/**
 * 解析 `pm2 jlist`。
 *
 * 只取 5 个安全字段 —— `pm2_env` 里还有进程启动时的**全部环境变量**，
 * 落库等于把数据库口令写进事实表，这里宁可少采也绝不整包存。
 */
export function parsePm2Processes(out: string): Pm2ProcessFact[] {
  if (!out?.trim()) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(out.trim());
  } catch {
    // ⚠️ 这里不能返回 [] ——「解析失败」和「线上真的没有进程」都是空结果，
    // 两条路径的结论却完全相反：前者是采集机制故障（应记 error），
    // 后者是业务状态（应记 missing）。返回 [] 会把一条本该报 error 的故障
    // 判成「线上服务不存在」，误导运维去重启一个正在跑的服务。
    // 起因：脱敏器曾把 jlist 的 JSON 改坏（引号被吞），prod 上 10 个 online
    // 进程被全判 missing，而同一批次的 port 事实却是全 ok —— 自相矛盾。
    throw new Error(`pm2 jlist 输出无法解析为 JSON：${out.trim().slice(0, 120)}`);
  }
  if (!Array.isArray(arr)) {
    throw new Error(`pm2 jlist 输出不是进程数组：${out.trim().slice(0, 120)}`);
  }
  const rows: Pm2ProcessFact[] = [];
  for (const raw of arr) {
    const r = raw as Record<string, unknown>;
    const env = (r.pm2_env ?? {}) as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name : null;
    if (!name) continue;
    rows.push({
      name,
      pid: typeof r.pid === 'number' ? r.pid : null,
      status: typeof env.status === 'string' ? env.status : null,
      cwd: (typeof env.pm_cwd === 'string' ? env.pm_cwd : null) ??
        (typeof env.cwd === 'string' ? env.cwd : null),
      restarts: typeof env.restart_time === 'number' ? env.restart_time : null,
    });
  }
  return rows;
}

/** 解析 `ss -ltn` 的监听端口集合 */
export function parseListeningPorts(out: string): number[] {
  if (!out) return [];
  const ports = new Set<number>();
  for (const line of out.split('\n')) {
    if (!line.includes('LISTEN')) continue;
    // 形如：LISTEN 0 128 0.0.0.0:6000 0.0.0.0:*
    // 末尾用 `(?:\s|$)`：端口正好在行尾时（列被截断 / 只输出一列）也要能取到，
    // 否则会静默解析成「没监听」，把一个正常服务判成 missing。
    const tail = String.raw`(?:\s|$)`;
    const m =
      line.match(new RegExp(String.raw`[:\.](?:\d{1,3}\.){3}\d{1,3}:(\d+)` + tail)) ??
      line.match(new RegExp(String.raw`\s\[?::\]?:(\d+)` + tail)) ??
      line.match(new RegExp(String.raw`:(\d+)` + tail));
    if (m) {
      const p = Number(m[1]);
      if (Number.isInteger(p) && p > 0 && p < 65536) ports.add(p);
    }
  }
  return [...ports].sort((a, b) => a - b);
}

/** 解析 `ls -1 <dir> | wc -l` 的条目数 */
export function parseEntryCount(out: string): number | null {
  if (!out) return null;
  const n = Number(out.trim().split('\n').pop()?.trim());
  return Number.isFinite(n) ? n : null;
}
