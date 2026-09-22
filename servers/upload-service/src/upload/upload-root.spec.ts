import * as os from 'os';
import * as path from 'path';
import {
  getUploadRoot,
  getUploadRootInfo,
  hasUploadRoot,
  setUploadRoot,
} from './upload-root';

/**
 * 进程内上传根目录持有者（A3）。
 *
 * 关键判据：**未初始化时必须抛错**，绝不静默回落 cwd —— 否则文件会散落到
 * 进程工作目录，且没有任何日志能解释它们为什么在那儿。
 */
describe('upload-root：上传根目录的进程内持有者', () => {
  it('未初始化 → getUploadRoot 抛错（不静默回落 cwd）', () => {
    expect(hasUploadRoot()).toBe(false);
    expect(() => getUploadRoot()).toThrow(/尚未初始化/);
  });

  it('初始化后可读到绝对路径与来源', () => {
    setUploadRoot(path.join(os.homedir(), 'web_system', 'uploads'), 'system_configs');
    expect(hasUploadRoot()).toBe(true);
    expect(getUploadRoot()).toBe(path.join(os.homedir(), 'web_system', 'uploads'));
    expect(getUploadRootInfo()).toEqual({
      path: path.join(os.homedir(), 'web_system', 'uploads'),
      source: 'system_configs',
    });
  });

  it('相对路径会被解析为绝对路径（避免随 cwd 漂移）', () => {
    setUploadRoot('uploads-test', 'env');
    expect(path.isAbsolute(getUploadRoot())).toBe(true);
    expect(getUploadRoot()).toBe(path.resolve('uploads-test'));
  });
});
