// 前端构建版本注入辅助：
// 1) appVersionDefine —— 通过 Vite define 把 git commit 织进 JS 全局变量
//    （window.__APP_VERSION__ / __APP_BUILD_TIME__ / __APP_GIT_BRANCH__）
// 2) appVersionPlugin —— 构建结束时写出 dist/version.json（部署库/网关兜底读取用）
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

function getGit() {
  let commit = '';
  let branch = '';
  try {
    commit = execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    commit = '';
  }
  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
  } catch {
    branch = '';
  }
  return { commit, branch };
}

export function appVersionDefine() {
  const { commit, branch } = getGit();
  const buildTime = new Date().toISOString();
  return {
    __APP_VERSION__: JSON.stringify(commit),
    __APP_BUILD_TIME__: JSON.stringify(buildTime),
    __APP_GIT_BRANCH__: JSON.stringify(branch),
  };
}

export function appVersionPlugin() {
  const { commit, branch } = getGit();
  const buildTime = new Date().toISOString();
  let outDir = 'dist';
  return {
    name: 'app-version',
    apply: 'build',
    configResolved(cfg) {
      outDir = cfg.build?.outDir || 'dist';
    },
    closeBundle() {
      const data = { version: commit, branch, buildTime };
      try {
        writeFileSync(resolve(outDir, 'version.json'), JSON.stringify(data, null, 2) + '\n');
      } catch (e) {
        // 不影响主构建
        console.warn('[app-version] 写 version.json 失败:', e.message);
      }
    },
  };
}
