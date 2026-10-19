import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';

const workflows = path.resolve(__dirname, '../../../../.github/workflows');

function evaluateJob(filename: string, branch: string, draft: boolean, sameRepository = true) {
  const source = fs.readFileSync(path.join(workflows, filename), 'utf8');
  const expression = /^    if: >-\r?\n((?:      .*\r?\n)+)/m.exec(source)?.[1];
  if (!expression) throw new Error('Workflow job condition unavailable');
  const repository = 'web5/web_system';
  return vm.runInNewContext('(' + expression + ')', {
    github: { repository, ref_name: branch, event: { pull_request: { draft, head: { ref: branch, repo: { full_name: sameRepository ? repository : 'fork/web_system' } } } } },
    startsWith: (value: string, prefix: string) => value.toLowerCase().startsWith(prefix.toLowerCase()),
    contains: (values: string[], value: string) => values.includes(value),
    fromJSON: JSON.parse,
  }, { timeout: 1000 });
}

describe('manual-review branch delivery policy', () => {
  it.each([
    ['feature/manual-review/todo-materials', false],
    ['feature/manual-review/todo-materials', true],
    ['FEATURE/MANUAL-REVIEW/todo-materials', false],
  ])('never enables automatic merge for %s (draft=%s)', (branch, draft) => {
    expect(evaluateJob('auto-merge.yml', branch as string, draft as boolean)).toBe(false);
  });

  it('retains ordinary ready branch behavior', () => {
    expect(evaluateJob('auto-merge.yml', 'feature/ordinary', false)).toBe(true);
  });

  it('still skips ordinary drafts and fork pull requests', () => {
    expect(evaluateJob('auto-merge.yml', 'feature/ordinary', true)).toBe(false);
    expect(evaluateJob('auto-merge.yml', 'feature/ordinary', false, false)).toBe(false);
  });

  it('keeps manual-review branches excluded from automatic pull request creation', () => {
    expect(evaluateJob('auto-pr.yml', 'feature/manual-review/todo-materials', false)).toBe(false);
  });
});
