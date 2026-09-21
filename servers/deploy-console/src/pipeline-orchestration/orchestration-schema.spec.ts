/**
 * 编排树结构校验单测（specs/pipeline-step-task/design.md §5 保存前校验）。
 *
 * bash 语法检查以回调注入（mock），专注结构规则：
 * 步骤名唯一 / 任务名组内唯一 / 动作名任务内唯一 / 条件语法 /
 * 审核任务不携带动作与变量 / 脚本任务至少一个动作 / 脚本非空与语法。
 */
import { validateTree, type StepInput } from './orchestration-schema';

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
});
