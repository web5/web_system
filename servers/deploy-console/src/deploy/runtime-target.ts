export interface RuntimeTargetInput {
  serviceDirectory: string;
  processNames: string[];
}

export function inspectRuntimeTarget(input: RuntimeTargetInput, adapters: { processes?: () => any[] } = {}) {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const child = require('node:child_process');
  const directory = fs.realpathSync(input.serviceDirectory);
  const entry = fs.realpathSync(path.join(directory, 'dist/main.js'));
  const list = adapters.processes || (() => {
    const home = process.env.PM2_HOME || path.join(os.homedir(), '.pm2');
    const pidFile = path.join(home, 'pm2.pid');
    if (!fs.existsSync(pidFile) || !fs.existsSync(path.join(home, 'rpc.sock'))) throw new Error('目标机没有已运行的 PM2 守护进程，拒绝自动创建');
    process.kill(Number(fs.readFileSync(pidFile, 'utf8').trim()), 0);
    return JSON.parse(child.execFileSync('pm2', ['jlist'], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }));
  });
  const matches = list().filter(row => input.processNames.includes(row.name));
  if (matches.length !== 1 || matches[0].pm2_env?.status !== 'online') {
    throw new Error('部署目标必须唯一匹配一个在线服务，拒绝猜测进程');
  }
  const selected = matches[0];
  if (!selected.pm2_env.pm_exec_path || fs.realpathSync(selected.pm2_env.pm_exec_path) !== entry) {
    throw new Error('登记部署目录与实际运行入口不一致，拒绝改写非运行树');
  }
  const cwd = fs.realpathSync(selected.pm2_env.pm_cwd);
  const project = path.resolve(directory, '../..');
  if (cwd !== directory && cwd !== project) throw new Error('服务 cwd 与运行根不一致');
  return { process: selected.name, pid: selected.pid, directory, entry, cwd };
}

export function runtimeTargetGuardCommand(input: RuntimeTargetInput): string {
  const payload = Buffer.from(JSON.stringify(input)).toString('base64');
  return "node <<'CONSOLE_RUNTIME_TARGET'\ntry{const result=(" + inspectRuntimeTarget.toString() +
    ")(JSON.parse(Buffer.from('" + payload + "','base64').toString('utf8')));process.stdout.write(JSON.stringify(result)+'\\n');}catch(error){console.error(error.message);process.exitCode=1;}\nCONSOLE_RUNTIME_TARGET\n";
}
