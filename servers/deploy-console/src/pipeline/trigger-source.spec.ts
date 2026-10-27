/**
 * triggerSource 归一化 / 三通道派生 / 审计 detail 的防回归测试。
 *
 * 背景（2026-10-27 PROD 发布触发源归因）：两轮非预期 PROD 批量发布经 MCP Key
 * 通道提交 + 自动审批触发，`operator=1` 无法区分会话/Key/脚本。本模块把
 * 「谁触发的」固化成可落库、可检索的短字符串；本测试钉死派生规则与注入防线。
 */
import { BadRequestException } from '@nestjs/common';
import {
  TRIGGER_SOURCE_MAX_LEN,
  assertTriggerSource,
  sanitizeSourceFragment,
  deriveUiTriggerSource,
  composeMcpTriggerSource,
  deriveCiTriggerSource,
  composeApprovalChannel,
  formatSubmitAuditDetail,
} from './trigger-source';

describe('assertTriggerSource（调用方传入白名单）', () => {
  it('空 / 缺省 → undefined（交由通道派生缺省值）', () => {
    expect(assertTriggerSource(undefined)).toBeUndefined();
    expect(assertTriggerSource(null)).toBeUndefined();
    expect(assertTriggerSource('')).toBeUndefined();
    expect(assertTriggerSource('   ')).toBeUndefined();
  });

  it('合法形态放行（会话 id / 脚本名 / 带通道前缀）', () => {
    expect(assertTriggerSource('ui')).toBe('ui');
    expect(assertTriggerSource('session-abc123')).toBe('session-abc123');
    expect(assertTriggerSource('web|sess-1')).toBe('web|sess-1');
    expect(assertTriggerSource('publish.sh')).toBe('publish.sh');
    expect(assertTriggerSource('a'.repeat(128))).toBe('a'.repeat(128));
  });

  it('含空格 / 引号 / 分号 / 换行等注入字符 → 400（不静默清洗）', () => {
    for (const bad of [
      'has space',
      "quote'and",
      'semi;colon',
      'new\nline',
      'dollar$var',
      'a'.repeat(129),
    ]) {
      expect(() => assertTriggerSource(bad)).toThrow(BadRequestException);
      expect(() => assertTriggerSource(bad)).toThrow(/triggerSource/);
    }
  });
});

describe('sanitizeSourceFragment（服务端派生片段）', () => {
  it('白名单外字符替换为 _，超长截断到 64', () => {
    expect(sanitizeSourceFragment('ai-ops-automation', 'x')).toBe('ai-ops-automation');
    // 空格与中文（白名单外）→ _；斜杠在白名单内保留
    expect(sanitizeSourceFragment('my key 名', 'x')).toBe('my_key__');
    expect(sanitizeSourceFragment('a'.repeat(100), 'x')).toBe('a'.repeat(64));
  });

  it('空 / null → fallback（保证拼出来的来源非空）', () => {
    expect(sanitizeSourceFragment(null, 'unknown')).toBe('unknown');
    expect(sanitizeSourceFragment('', 'unknown')).toBe('unknown');
    expect(sanitizeSourceFragment('  ', 'unknown')).toBe('unknown');
    expect(sanitizeSourceFragment('***', 'unknown')).toBe('___');
  });
});

describe('deriveUiTriggerSource（UI 通道）', () => {
  it('缺省派生 ui；带标识则透传', () => {
    expect(deriveUiTriggerSource(undefined)).toBe('ui');
    expect(deriveUiTriggerSource('page-releases')).toBe('page-releases');
  });
});

describe('composeMcpTriggerSource（MCP 通道强制并入 Key 名）', () => {
  it('无 body 来源 → mcp:<keyName>', () => {
    expect(composeMcpTriggerSource(undefined, 'ai-ops-automation')).toBe(
      'mcp:ai-ops-automation',
    );
  });

  it('有 body 来源 → <body>|mcp:<keyName>（Key 名不可被抹掉）', () => {
    expect(composeMcpTriggerSource('web|sess-1', 'ai-ops-automation')).toBe(
      'web|sess-1|mcp:ai-ops-automation',
    );
  });

  it('keyName 缺失 → mcp:unknown（不静默丢通道）', () => {
    expect(composeMcpTriggerSource(undefined, undefined)).toBe('mcp:unknown');
    expect(composeMcpTriggerSource('x', null)).toBe('x|mcp:unknown');
  });

  it('超长时截 body 段、保 mcp 段（强制段不被截掉）', () => {
    const out = composeMcpTriggerSource('b'.repeat(200), 'key1');
    expect(out.endsWith('|mcp:key1')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(TRIGGER_SOURCE_MAX_LEN);
  });

  it('keyName 脏字符被替换，不打挂提交', () => {
    expect(composeMcpTriggerSource(undefined, 'my key')).toBe('mcp:my_key');
  });
});

describe('deriveCiTriggerSource（hook 通道）', () => {
  it('ci:<source> 形态，与 operator 对齐', () => {
    expect(deriveCiTriggerSource('release.yml')).toBe('ci:release.yml');
    expect(deriveCiTriggerSource('github-actions')).toBe('ci:github-actions');
    expect(deriveCiTriggerSource(undefined)).toBe('ci:unknown');
  });

  it('脏 source 被替换，长度受控', () => {
    // 空格/中文 → _；斜杠在白名单内保留
    expect(deriveCiTriggerSource('wf name/中文')).toBe('ci:wf_name/__');
    expect(deriveCiTriggerSource('x'.repeat(200)).length).toBeLessThanOrEqual(3 + 64);
  });
});

describe('composeApprovalChannel（审批通道审计标记）', () => {
  it('缺省 ui；显式通道透传（含 mcp:<keyName>）', () => {
    expect(composeApprovalChannel(undefined)).toBe('ui');
    expect(composeApprovalChannel('')).toBe('ui');
    expect(composeApprovalChannel('mcp:ai-ops-automation')).toBe('mcp:ai-ops-automation');
    expect(composeApprovalChannel('  ui:page  ')).toBe('ui:page');
  });
});

describe('formatSubmitAuditDetail（审计 detail 必含 triggerSource）', () => {
  it('含来源= 段，可检索', () => {
    const s = formatSubmitAuditDetail('job-1', 'direct', 'content-hub 发布', 'mcp:ai-ops-automation');
    expect(s).toContain('来源=mcp:ai-ops-automation');
    expect(s).toContain('job-1');
    expect(s).toContain('mode=direct');
    expect(s).toContain('模板=content-hub 发布');
  });

  it('无来源时不编造（向后兼容老路径）', () => {
    const s = formatSubmitAuditDetail('job-1', 'direct', 'tpl', undefined);
    expect(s).not.toContain('来源=');
  });

  it('待审批尾缀保留', () => {
    const s = formatSubmitAuditDetail('job-1', 'direct', 'tpl', 'ui', true);
    expect(s).toContain('需审批，已阻断等待');
    expect(s).toContain('来源=ui');
  });
});
