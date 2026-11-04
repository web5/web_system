import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpProbeService } from '../probe/http-probe.service';
import {
  CDN_MANIFEST_FILE,
  buildLocalManifest,
  describeDiff,
  diffManifests,
  parseSha256Manifest,
} from './cdn-verify';
import { cdnAssetUrl, cdnLayoutMode, resolveCdnOrigin } from './release-paths';

export interface CdnVerifyInput {
  env: string;
  /** 模块 key（= CDN 路径里的 app 段） */
  app: string;
  /** 版本 / commit（= CDN 路径里的 commit 段） */
  commit: string;
  /** 本地产物目录（构建输出） */
  localDir: string;
  /** 可选日志回调（流水线日志） */
  log?: (line: string) => void;
}

export interface CdnVerifySummary {
  /** 对账通过的文件数 */
  files: number;
  /** 被校验的产物目录 URL */
  baseUrl: string;
}

/**
 * 切指针前的 CDN 硬门禁（**P0**，方案 §5「verify 之后才切 DB 指针」）。
 *
 * 为什么放在平台代码而不是流水线脚本里：
 * 脚本是数据（`deploy_pipeline_actions` 正文），可以少写一行 `verify` 就静默跳过；
 * 而「切了指针但资源 404」的后果是线上白屏，必须由结构保证，不能靠模板自律。
 *
 * 默认零变化：`CDN_LAYOUT_MODE` 不是 `cdn` 时**直接返回**，不发任何请求（legacy 路径逐字节不变）。
 */
@Injectable()
export class CdnAssetVerifier {
  private readonly logger = new Logger(CdnAssetVerifier.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly probe: HttpProbeService,
  ) {}

  private cfg = (key: string): string | undefined => this.configService.get<string>(key);

  /** 是否处于 CDN 布局（供调用方决定要不要进这道门，避免重复读配置） */
  isCdnMode(): boolean {
    return cdnLayoutMode(this.cfg) === 'cdn';
  }

  /**
   * 校验入口机产物「可对外服务」且「内容一致」，不通过则抛错（→ 流水线失败 → 自动回滚）。
   *
   * 四道判据：
   * 1. `CDN_ORIGIN_<ENV>` 必须配（配错/没配直接失败，不静默跳过）
   * 2. 本地目录必须真的有产物（空目录是最常见的「构建没产出却报成功」）
   * 3. `_manifest.sha256` 可取到且 200 —— 证明 nginx `/cdn/` 规则已生效、路径对得上
   * 4. 清单逐文件哈希与本地一致 —— 证明内容没被截断/覆盖
   */
  async assertReady(input: CdnVerifyInput): Promise<CdnVerifySummary | null> {
    if (!this.isCdnMode()) return null;

    const { env, app, commit, localDir } = input;
    const log = input.log ?? (() => undefined);

    const origin = resolveCdnOrigin(this.cfg, env);
    if (!origin) {
      throw new Error(
        `CDN 校验前置缺失：CDN_LAYOUT_MODE=cdn 但未配置 CDN_ORIGIN_${env.toUpperCase().replace(/[^A-Z0-9]/g, '_')}（或 CDN_ORIGIN）。` +
          '不允许跳过校验——「磁盘对了但 nginx 没配」正是必须抓出来的场景。',
      );
    }

    const local = await buildLocalManifest(localDir);
    if (!local.size) {
      throw new Error(`CDN 校验失败：本地产物目录为空 ${localDir}（构建无产出却要继续切指针）`);
    }

    const baseUrl = cdnAssetUrl(origin, env, app, commit, CDN_MANIFEST_FILE);
    const got = await this.probe.getText(baseUrl, 25_000);
    if (!got.ok) {
      throw new Error(
        `CDN 校验失败：取不到产物清单 ${baseUrl} → HTTP ${got.status}` +
          '（常见原因：nginx /cdn/ 规则未生效、上传路径与 URL 段不一致、commit 目录不存在）',
      );
    }

    const remote = parseSha256Manifest(got.text);
    const diff = diffManifests(local, remote);
    if (!diff.ok) {
      throw new Error(`CDN 校验失败：${describeDiff(diff, local.size, remote.size)}（清单 ${baseUrl}）`);
    }

    // 入口文件单独探一次：清单在 ≠ 入口能被当 JS 服务出去（MIME / 权限 / 符号链接都可能只坏入口）
    if (local.has('index.js')) {
      const entryUrl = cdnAssetUrl(origin, env, app, commit, 'index.js');
      const head = await this.probe.request(entryUrl, 'HEAD', 15_000);
      if (!head.ok) {
        throw new Error(`CDN 校验失败：入口不可访问 ${entryUrl} → HTTP ${head.status}`);
      }
    }

    const summary: CdnVerifySummary = { files: local.size, baseUrl: origin };
    log(`CDN 校验通过：${local.size} 个文件哈希一致（${origin}/${env}/${app}/${commit}/）`);
    this.logger.log(`CDN 校验通过 ${env}/${app}/${commit} files=${local.size}`);
    return summary;
  }
}
