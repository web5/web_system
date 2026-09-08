import { Injectable } from '@nestjs/common';
import { HttpProbeService } from '../probe/http-probe.service';
import { CommandService } from '../shell/command.service';

/** pm2 进程信息（jlist 子集） */
export interface Pm2App {
  name?: string;
  pid?: number;
  pm2_env?: { status?: string; PORT?: string | number };
}

/** 候选进程扫描明细 */
export interface Pm2Scan {
  name: string;
  /** pm2 status：online/stopped/errored…；pm2 中无此进程 = undefined */
  status?: string;
}

/** 单次 pm2 健康探活结果（探活本身不抛错；pm2 查询异常向上抛，由调用方决定轮询/降级） */
export interface Pm2ProbeResult {
  /** 是否命中 online 进程 */
  online: boolean;
  /** 命中的进程（仅 online 时） */
  hit?: Pm2Scan & { port?: string | number };
  /** 按候选顺序的扫描明细（供调用方生成等待日志） */
  scans: Pm2Scan[];
  /** 命中进程端口 HTTP 是否可达（仅 online 且带 PORT 时判定） */
  reachable?: boolean;
}

/**
 * pm2 进程健康探活工具（V6 verify 内置步骤的后端执行体）。
 *
 * 收敛自 pipeline.service.ts：原「解析服务名候选 → pm2 jlist → 取 PORT → HTTP 探活」
 * 内联在 verifyBackend / probeBackendHealth / stageRestart 三处。本服务统一承载，
 * 各步骤（restart / verify / 回滚后探活）通过 DI 注入复用；未来 V7 如需远端 pm2，
 * 只换本服务实现（service-kind: remote），步骤与模板不受影响。
 *
 * HTTP 探活复用 HttpProbeService（Node fetch 访问不了 6000 等 X11 bad-port 的说明见该服务）；
 * pm2 命令执行与 PATH 补齐复用 CommandService。
 */
@Injectable()
export class Pm2ProbeService {
  constructor(
    private readonly httpProbe: HttpProbeService,
    private readonly command: CommandService,
  ) {}

  /**
   * 解析实际 pm2 服务名候选。模块注册表的 pm2 字段与实际 pm2 名经常不一致
   * （如 todo-service → web-todo、auth-service → web-auth），按常见命名生成候选：
   *   mod.pm2 / web-<key> / web-<去-service 后缀> / <key> / <去-service 后缀>
   */
  resolvePm2Names(moduleKey: string, modPm2?: string): string[] {
    const base = moduleKey.endsWith('-service') ? moduleKey.replace(/-service$/, '') : moduleKey;
    const names = [modPm2, `web-${moduleKey}`, `web-${base}`, moduleKey, base].filter(
      (n): n is string => !!n,
    );
    return [...new Set(names)];
  }

  /** pm2 进程列表（jlist；pm2 为 daemon 查询，与 cwd 无关） */
  listProcesses(): Pm2App[] {
    const out = this.command.exec(`"${this.command.pm2Bin()}" jlist`, process.cwd());
    return JSON.parse(out) as Pm2App[];
  }

  /**
   * 单次健康探活：按候选顺序找第一个 online 进程 →（有 PORT）HTTP 探活端口是否可服务。
   *
   * - pm2 查询 / JSON 解析异常：直接向上抛（调用方按「查询失败」处理：轮询或降级）
   * - online 但无 PORT：返回 online=true、reachable 为空（调用方决定降级语义）
   */
  async probeOnce(
    moduleKey: string,
    modPm2?: string,
    timeoutMs = 3000,
  ): Promise<Pm2ProbeResult> {
    const names = this.resolvePm2Names(moduleKey, modPm2);
    const apps = this.listProcesses();
    const scans: Pm2Scan[] = names.map((name) => {
      const app = apps.find((a) => a.name === name);
      return { name, status: app?.pm2_env?.status };
    });
    const hitScan = scans.find((s) => s.status === 'online');
    if (!hitScan) return { online: false, scans };

    const app = apps.find((a) => a.name === hitScan.name);
    const port = app?.pm2_env?.PORT;
    const hit = { ...hitScan, port };
    if (port == null) return { online: true, hit, scans };

    const probe = await this.httpProbe.request(`http://127.0.0.1:${port}/`, 'GET', timeoutMs);
    return { online: true, hit, scans, reachable: probe.status > 0 };
  }
}
