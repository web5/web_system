import * as fs from 'fs';
import * as path from 'path';
import { WriteFileTool } from './write-file.tool';
import { ToolContext } from '../../interfaces/tool.interface';

const ctx = (confirm?: (m: string) => Promise<boolean>): ToolContext => ({
  userId: 'u',
  runId: 'r',
  deps: {},
  confirm,
});

describe('WriteFileTool', () => {
  const tool = new WriteFileTool();
  let tmpDir: string;

  // 临时目录必须放在 process.cwd() 内，否则会被工具判定为越界
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(process.cwd(), '.tmp-wft-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const rel = (name: string) => path.relative(process.cwd(), path.join(tmpDir, name));

  it('无 confirm 时所有写操作默认拒绝', async () => {
    const r = await tool.execute({ path: rel('a.txt'), content: 'x' }, ctx());
    expect(r.success).toBe(false);
    expect(r.error).toContain('拒绝');
  });

  it('新建文件：confirm true 后创建成功', async () => {
    const p = rel('new.txt');
    const r = await tool.execute({ path: p, content: 'hello' }, ctx(async () => true));
    expect(r.success).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, 'new.txt'), 'utf-8')).toBe('hello');
  });

  it('新建文件 confirm false 时拒绝且不写入', async () => {
    const p = rel('no.txt');
    const r = await tool.execute({ path: p, content: 'x' }, ctx(async () => false));
    expect(r.success).toBe(false);
    expect(r.error).toContain('拒绝');
    expect(fs.existsSync(path.join(tmpDir, 'no.txt'))).toBe(false);
  });

  it('覆盖已存在文件：confirm true 后覆盖', async () => {
    const p = rel('ov.txt');
    fs.writeFileSync(path.join(tmpDir, 'ov.txt'), 'old');
    const r = await tool.execute({ path: p, content: 'new', mode: 'overwrite' }, ctx(async () => true));
    expect(r.success).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, 'ov.txt'), 'utf-8')).toBe('new');
  });

  it('追加：confirm true 后追加而非覆盖', async () => {
    const p = rel('ap.txt');
    fs.writeFileSync(path.join(tmpDir, 'ap.txt'), 'a');
    const r = await tool.execute({ path: p, content: 'b', mode: 'append' }, ctx(async () => true));
    expect(r.success).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, 'ap.txt'), 'utf-8')).toBe('ab');
  });

  it('路径越界被拒绝', async () => {
    const r = await tool.execute({ path: '../../etc/passwd', content: 'x' }, ctx(async () => true));
    expect(r.success).toBe(false);
    expect(r.error).toContain('越界');
  });
});
