/**
 * shell 子进程组终止（纯函数，便于单测）。
 *
 * 背景：`bash -c` 派生的 vite / nest build 等实际构建进程是孙进程，
 * 只终止 bash 本身会残留孙进程继续占用端口与 CPU ——
 * 这正是历史上「6200 孤儿进程抢端口、发布不生效」的同类根因。
 * 因此以 detached 进程组启动，终止时用**负 pid** 一次性杀整组；
 * 平台不支持负 pid（如 Windows）时降级为终止直接子进程。
 *
 * 放在 shell/ 而非 pipeline.service 内：shell-runner（P0 可注入执行通道）也要用，
 * 避免 shell 层反向依赖 pipeline 层造成循环引用。
 */

/** 进程终止方式：group=按进程组整组终止（负 pid）/ child=降级为直接子进程 / none=已退出 */
export type KillResult = 'group' | 'child' | 'none';

export function killShellProcess(
  pid: number,
  killGroup: (pid: number, signal: NodeJS.Signals) => void,
  killChild: (signal: NodeJS.Signals) => void,
): KillResult {
  if (!pid) return 'none';
  try {
    killGroup(-pid, 'SIGKILL');
    return 'group';
  } catch {
    try {
      killChild('SIGKILL');
      return 'child';
    } catch {
      return 'none';
    }
  }
}
