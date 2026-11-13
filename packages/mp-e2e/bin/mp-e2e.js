#!/usr/bin/env node
/**
 * mp-e2e CLI 入口（npm script 指向它："test:e2e": "mp-e2e"）。
 * 在 app 根（cwd）执行：读 ./e2e.config.js → preflight → 顺序跑 casesDir。
 *
 * 用法：
 *   mp-e2e [--config <path>] [--filter <文件名子串>]
 *
 * exit code：0 全过（BLOCKED 不计失败）/ 1 有 FAIL 或 preflight 静态守卫不通过 /
 * 2 环境不可用且 MP_E2E_REQUIRE_ENV=1（默认环境不可用 exit 0，全 SKIP）。
 */

const path = require('path');
const { runSuite } = require('../src/runner');

function parseArgs(argv) {
  const out = { config: 'e2e.config.js', filter: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config') out.config = argv[++i];
    else if (argv[i] === '--filter') out.filter = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('用法: mp-e2e [--config <path>] [--filter <文件名子串>]');
      process.exit(0);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const configPath = path.resolve(process.cwd(), args.config);

runSuite({ configPath, filter: args.filter })
  .then((code) => process.exit(code))
  .catch((e) => {
    // preflight 静态守卫 FAIL-fast 与配置错误走这里：是真红，exit 1
    console.error(e && e.message ? e.message : e);
    process.exit(1);
  });
