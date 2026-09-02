import { EXTRA_PATH_DIRS, buildChildEnv } from './command.service';

describe('command.service（命令执行 PATH 收口）', () => {
  const ORIG_PATH = process.env.PATH;

  afterEach(() => {
    if (ORIG_PATH) process.env.PATH = ORIG_PATH;
  });

  it('子进程 env 继承 process.env 并补全 PATH（含 node 目录，放最后）', () => {
    process.env.PATH = '/usr/bin';
    process.env.FOO = 'bar';
    const env = buildChildEnv({ DEPLOY_ENV: 'local' }, '/opt/node/bin');
    expect(env.FOO).toBe('bar');
    expect(env.DEPLOY_ENV).toBe('local');
    expect(env.PATH).toBe(`/usr/bin:${[...EXTRA_PATH_DIRS, '/opt/node/bin'].join(':')}`);
  });

  it('extraEnv 覆盖 process.env 同名键', () => {
    process.env.PORT = '6005';
    const env = buildChildEnv({ PORT: '6200' });
    expect(env.PORT).toBe('6200');
  });

  it('未传 nodeBinDir 时不追加 node 目录', () => {
    process.env.PATH = '/usr/bin';
    expect(buildChildEnv({}).PATH).toBe(`/usr/bin:${EXTRA_PATH_DIRS.join(':')}`);
  });
});
