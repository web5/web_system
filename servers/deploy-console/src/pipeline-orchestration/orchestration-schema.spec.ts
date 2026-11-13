/**
 * 编排树结构校验单测（specs/pipeline-step-task/design.md §5 保存前校验）。
 *
 * bash 语法检查以回调注入（mock），专注结构规则：
 * 步骤名唯一 / 任务名组内唯一 / 动作名任务内唯一 / 条件语法 /
 * 审核任务不携带动作与变量 / 脚本任务至少一个动作 / 脚本非空与语法。
 */
import { validateTree, findSelfPointerWrites, type StepInput } from './orchestration-schema';
import { undeclaredVars } from './script-vars';

const okScript = () => undefined; // bash -n 通过的 mock
const badScript = () => {
  throw new Error('syntax error near unexpected token');
};

function validTree(): StepInput[] {
  return [
    {
      name: '拉取代码',
      tasks: [
        {
          kind: 'script',
          name: 'git',
          actions: [
            { name: '校验代码来源与分支', script: '#!/usr/bin/env bash\ntrue' },
            { name: '检出目标分支并自证', script: '#!/usr/bin/env bash\ntrue' },
          ],
        },
      ],
    },
    {
      name: '发布',
      tasks: [
        {
          kind: 'script',
          name: 'local',
          condition: 'DEPLOY_ENV == local',
          actions: [
            { name: '发布文件到目标位置', script: 'cp -R "$SRC"/. "$DST"/' },
            { name: 'write-version · 写版本记录', script: 'curl -sf "$CONSOLE_API/versions"' },
          ],
        },
        {
          kind: 'script',
          name: 'dev',
          condition: 'DEPLOY_ENV == dev',
          actions: [{ name: '打包上传到远程主机', script: 'scp a b:c' }],
        },
      ],
    },
    { name: '发布确认', tasks: [{ kind: 'approval', name: '审批门禁', approval: { approvers: ['ops'] } }] },
  ];
}

describe('validateTree（编排树结构校验）', () => {
  it('合法整树（admin 发布完整结构）零错误', () => {
    expect(validateTree(validTree(), okScript)).toEqual([]);
  });

  it('步骤名重复被拒', () => {
    const tree = validTree();
    tree[1].name = tree[0].name;
    const errs = validateTree(tree, okScript);
    expect(errs.some((e) => e.includes('步骤名重复'))).toBe(true);
  });

  it('步骤名为空被拒', () => {
    const tree = validTree();
    tree[0].name = '  ';
    expect(validateTree(tree, okScript).some((e) => e.includes('名称不能为空'))).toBe(true);
  });

  it('同步骤任务名重复被拒；不同步骤同名任务放行', () => {
    const tree = validTree();
    tree[1].tasks![1].name = tree[1].tasks![0].name; // local/dev 撞名
    const errs = validateTree(tree, okScript);
    expect(errs.some((e) => e.includes('任务名重复'))).toBe(true);
    expect(errs.length).toBe(1);
  });

  it('任务内动作名重复被拒', () => {
    const tree = validTree();
    tree[0].tasks![0].actions![1].name = tree[0].tasks![0].actions![0].name;
    expect(validateTree(tree, okScript).some((e) => e.includes('动作名重复'))).toBe(true);
  });

  it('条件表达式非法被拒（沿用 condition.ts 校验）', () => {
    const tree = validTree();
    tree[1].tasks![0].condition = 'DEPLOY_ENV = local'; // 缺少 == 的空格
    const errs = validateTree(tree, okScript);
    expect(errs.some((e) => e.includes('local') && e.includes('条件项不合法'))).toBe(true);
  });

  it('审核任务缺审批人 / 携带动作 / 携带环境变量均被拒', () => {
    const tree = validTree();
    const approval = tree[2].tasks![0];
    approval.approval = { approvers: [] };
    approval.actions = [{ name: 'x', script: 'true' }];
    approval.env = { A: '1' };
    const errs = validateTree(tree, okScript);
    expect(errs.some((e) => e.includes('至少一个审批人'))).toBe(true);
    expect(errs.some((e) => e.includes('审核任务不能携带动作'))).toBe(true);
    expect(errs.some((e) => e.includes('审核任务不能携带环境变量'))).toBe(true);
  });

  it('脚本任务零动作被拒', () => {
    const tree = validTree();
    tree[0].tasks![0].actions = [];
    expect(validateTree(tree, okScript).some((e) => e.includes('至少需要一个动作'))).toBe(true);
  });

  it('动作脚本为空 / 语法错误被拒（错误定位到 步骤/任务/动作）', () => {
    const tree = validTree();
    tree[0].tasks![0].actions![0].script = '';
    tree[0].tasks![0].actions![1].script = 'if [; then';
    const errs = validateTree(tree, badScript);
    expect(errs.some((e) => e.includes('脚本不能为空'))).toBe(true);
    expect(errs.some((e) => e.includes('检出目标分支并自证') && e.includes('语法错误'))).toBe(true);
  });

  it('kind 非法被拒', () => {
    const tree = validTree();
    (tree[0].tasks![0] as unknown as { kind: string }).kind = 'shell';
    expect(validateTree(tree, okScript).some((e) => e.includes('kind 必须是'))).toBe(true);
  });

  it('步骤无任务是合法的（纯分组占位）', () => {
    const tree: StepInput[] = [{ name: '占位' }];
    expect(validateTree(tree, okScript)).toEqual([]);
  });

  it('变量门禁：传 checkVars 时未声明变量被拒，不传则不做该检查', () => {
    const tree = validTree();
    tree[0].tasks![0].actions![0].script = 'curl "$CONSOLE_TOKEN_PROD"';
    // 不传 checkVars —— 与历史行为一致，不拦
    expect(validateTree(tree, okScript)).toEqual([]);
    // 传 checkVars —— 拒绝并说明修法
    const errs = validateTree(tree, okScript, (s) => undeclaredVars(s));
    expect(errs.some((e) => e.includes('CONSOLE_TOKEN_PROD') && e.includes('未声明变量'))).toBe(true);
    // 登记后放行（基础样例里的 SRC/DST 一并登记，它们属于该断言的无关噪音）
    const declared = new Set(['CONSOLE_TOKEN_PROD', 'SRC', 'DST']);
    expect(validateTree(tree, okScript, (s) => undeclaredVars(s, declared))).toEqual([]);
  });
});

/**
 * 半发布治理 F1-①：编排脚本禁止自写磁盘入口指针（检出即报错）。
 *
 * 背景：11-09 portal 半发布 = 发布脚本自写 `static/modules/<app>/<env>/index.js`
 * 磁盘指针却不落表，错位存活 2 天。磁盘指针的唯一写入口是平台原子步
 * （AppsService.switchVersion / internal/release/pointer 的 env-dir 分支）。
 */
describe('findSelfPointerWrites（脚本自写盘指针检出）', () => {
  it('重定向 / heredoc 写入盘指针文件被检出', () => {
    const hits = findSelfPointerWrites(
      [
        'cat > /data/web_system_static/public/static/modules/portal/prod/index.js <<\'EOF\'',
        "System.register(['./abc1234/index.js'], function () {});",
        'EOF',
      ].join('\n'),
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toContain('static/modules/portal/prod/index.js');
  });

  it('echo 追加 / tee / cp / mv / ln -s 以盘指针为目标的写法被检出', () => {
    const cases = [
      'echo "x" >> static/modules/portal/prod/index.js',
      "echo 'x' | tee static/modules/portal/prod/index.css",
      'cp /tmp/new-pointer.js static/modules/portal/prod/index.js',
      'mv /tmp/p.js /data/static/modules/portal/prod/index.js',
      'ln -sf ./abc1234/index.js static/modules/portal/prod/index.js',
    ];
    for (const c of cases) {
      expect(findSelfPointerWrites(c).length).toBeGreaterThan(0);
    }
  });

  it('node -e 直调 writeEnvEntryPointer 被检出', () => {
    const hits = findSelfPointerWrites(
      `node -e "require('./entry-pointer').writeEnvEntryPointer('/root','portal','prod','abc')"`,
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  it('合法行为零误伤：调 pointer 接口 / 读指针 / 写结果文件 / 拷版本目录', () => {
    const okCases = [
      'curl -sf -X POST "$CONSOLE_API/internal/release/pointer" -d \'{"moduleKey":"portal"}\'',
      'cat static/modules/portal/prod/index.js | grep System.register',
      'test -f static/modules/portal/prod/abc1234/index.js',
      'echo "{\"v\":\"$V\"}" > "$WS_RESULT_FILE"',
      'cp -R static/modules/portal/prod/abc1234 /tmp/backup/',
      'cp static/modules/portal/prod/index.js /tmp/pointer.bak',
      'grep -o "\'\\./.*/index\\.js\'" static/modules/portal/prod/index.js',
    ];
    for (const c of okCases) {
      expect(findSelfPointerWrites(c)).toEqual([]);
    }
  });

  it('validateTree 集成：含自写盘指针的动作保存即报错，文案指明正规通道', () => {
    const tree = validTree();
    tree[1].tasks![0].actions![0].script =
      'cat > /data/static/modules/portal/prod/index.js <<EOF\nx\nEOF';
    const errs = validateTree(tree, okScript);
    expect(errs.some((e) => e.includes('禁止脚本自写磁盘入口指针'))).toBe(true);
    expect(errs.some((e) => e.includes('/internal/release/pointer'))).toBe(true);
  });
});
