/**
 * 事实采集命令的**只读约束**（纯函数，便于单测锁住）。
 *
 * 为什么需要它：事实采集要往目标机（含 prod）执行命令。采集器一旦能拼任意命令，
 * 这个模块就从"观测"退化成"远程执行通道"，而它是**定时自动跑**的 —— 出事时没人点确认。
 *
 * 三条硬约束：
 * 1. 命令必须以白名单前缀开头（只做读：cat / ls / md5sum / stat / test / readlink / pm2 jlist / ss -ltn）；
 * 2. 出现任何危险字符一律拒绝（分号、逻辑运算、命令替换、重定向、写/删/杀类命令）；
 * 3. 管道只允许 `| wc -l`（唯一需要的组合）。
 *
 * 与 `SshExecService` 的既有防护不冲突：那边防的是"执行超时/退出码/输出脱敏"，
 * 这边防的是"采集器被人塞进一条写命令"。
 */

/** 允许的命令前缀（只含只读命令） */
export const FACT_CMD_ALLOWLIST = [
  'cat ',
  'ls ',
  'md5sum ',
  'stat ',
  'test ',
  'readlink ',
  'pm2 jlist',
  'ss -ltn',
] as const;

/** 出现即拒绝：分号 / 逻辑运算 / 命令替换 / 重定向 / 破坏性命令 / 外连命令 */
const DANGEROUS_TOKENS = [
  ';',
  '&&',
  '||',
  '`',
  '$(',
  '>',
  '<',
  '\n',
  '\r',
  'rm',
  'mv',
  'cp',
  'chmod',
  'chown',
  'kill',
  'curl',
  'wget',
  'ssh',
  'scp',
  'tee',
  'dd',
];

/** 唯一允许的管道后缀 */
const ALLOWED_PIPE = '| wc -l';

export class UnsafeFactCommandError extends Error {
  constructor(readonly cmd: string, readonly reason: string) {
    super(`事实采集命令被拒（${reason}）：${cmd}`);
    this.name = 'UnsafeFactCommandError';
  }
}

/** 命令是否安全（不抛错版本，供校验与测试复用） */
export function isSafeFactCommand(cmd: string): boolean {
  try {
    assertSafeFactCommand(cmd);
    return true;
  } catch {
    return false;
  }
}

/**
 * 校验采集命令：不安全直接抛错。
 *
 * 判据顺序有讲究：先看**管道**（涉及整条命令的结构），再看危险字符，最后看前缀白名单 ——
 * 否则 `ls x | wc -l` 会因管道里的空格被后面的检查误伤。
 */
export function assertSafeFactCommand(cmd: string): void {
  const c = (cmd ?? '').trim();
  if (!c) throw new UnsafeFactCommandError(cmd, '空命令');

  // ① 管道：只允许一段 `| wc -l`，且管道前的部分必须独立合法
  const pipeIdx = c.indexOf('|');
  if (pipeIdx >= 0) {
    const tail = c.slice(pipeIdx).trim();
    if (tail !== ALLOWED_PIPE) {
      throw new UnsafeFactCommandError(cmd, `管道只允许 \`${ALLOWED_PIPE}\``);
    }
    assertSafeFactCommand(c.slice(0, pipeIdx));
    return;
  }

  // ② 危险字符 / 破坏性命令（按 token 匹配，避免把 `restarts` 这类正常词误判成 `rm`）
  const lower = c.toLowerCase();
  for (const t of DANGEROUS_TOKENS) {
    if (t === 'rm' || t === 'mv' || t === 'cp' || t === 'ssh' || t === 'dd') {
      const re = new RegExp(`(^|[\\s/])${t}($|\\s)`);
      if (re.test(lower)) throw new UnsafeFactCommandError(cmd, `含危险命令 \`${t}\``);
      continue;
    }
    if (lower.includes(t)) throw new UnsafeFactCommandError(cmd, `含危险字符 \`${t}\``);
  }

  // ③ 前缀白名单
  if (!FACT_CMD_ALLOWLIST.some((p) => c.startsWith(p))) {
    throw new UnsafeFactCommandError(cmd, `不在只读白名单内（允许：${FACT_CMD_ALLOWLIST.join(' / ')}）`);
  }
}

/** 读文件（指针） */
export function cmdReadFile(absPath: string): string {
  const cmd = `cat ${absPath}`;
  assertSafeFactCommand(cmd);
  return cmd;
}

/** 数目录下的条目数（版本目录是否真的有产物） */
export function cmdCountEntries(absDir: string): string {
  const cmd = `ls -1 ${absDir} | wc -l`;
  assertSafeFactCommand(cmd);
  return cmd;
}

/** pm2 进程清单（JSON） */
export function cmdPm2List(): string {
  const cmd = 'pm2 jlist';
  assertSafeFactCommand(cmd);
  return cmd;
}

/** 监听端口清单 */
export function cmdListeningPorts(): string {
  const cmd = 'ss -ltn';
  assertSafeFactCommand(cmd);
  return cmd;
}
