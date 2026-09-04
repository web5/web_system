import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectSensitive,
  maskString,
  applyMask,
  maskRow,
  MASK_PLACEHOLDER,
} from './masking';

describe('detectSensitive', () => {
  it('凭证类字段判定为 hidden', () => {
    assert.equal(detectSensitive('password'), 'hidden');
    assert.equal(detectSensitive('api_key'), 'hidden');
    assert.equal(detectSensitive('accessToken'), 'hidden');
    assert.equal(detectSensitive('session_key'), 'hidden');
    assert.equal(detectSensitive('salt'), 'hidden');
  });

  it('个人信息类字段判定为 masked', () => {
    assert.equal(detectSensitive('phone'), 'masked');
    assert.equal(detectSensitive('mobile'), 'masked');
    assert.equal(detectSensitive('id_card'), 'masked');
    // 真实列名是 mp_openid / oa_openid，子串匹配需命中
    assert.equal(detectSensitive('mp_openid'), 'masked');
    assert.equal(detectSensitive('oa_openid'), 'masked');
    assert.equal(detectSensitive('unionid'), 'masked');
    assert.equal(detectSensitive('email'), 'masked');
  });

  it('普通字段判定为 none', () => {
    assert.equal(detectSensitive('username'), 'none');
    assert.equal(detectSensitive('created_at'), 'none');
    assert.equal(detectSensitive('id'), 'none');
    assert.equal(detectSensitive('status'), 'none');
  });

  it('大小写不敏感', () => {
    assert.equal(detectSensitive('Password'), 'hidden');
    assert.equal(detectSensitive('PHONE'), 'masked');
  });
});

describe('maskString', () => {
  it('手机号保留前 3 后 4', () => {
    assert.equal(maskString('13812348888'), '138****8888');
  });

  it('邮箱隐藏 local 部分但保留域名', () => {
    assert.equal(maskString('kevin@example.com'), 'k***@example.com');
  });

  it('过短字符串整体打码', () => {
    assert.equal(maskString('123'), '***');
    assert.equal(maskString('abcd'), '****');
  });

  it('中等长度保留首尾各 1 位', () => {
    assert.equal(maskString('1381234'), '1***4');
  });

  it('空串原样返回', () => {
    assert.equal(maskString(''), '');
  });
});

describe('applyMask', () => {
  it('hidden 级别一律返回占位符，与原值类型无关', () => {
    assert.equal(applyMask('$2b$10$abcdef', 'hidden'), MASK_PLACEHOLDER);
    assert.equal(applyMask(12345, 'hidden'), MASK_PLACEHOLDER);
    assert.equal(applyMask({ a: 1 }, 'hidden'), MASK_PLACEHOLDER);
  });

  it('masked 级别对字符串打码', () => {
    assert.equal(applyMask('13812348888', 'masked'), '138****8888');
  });

  it('masked 级别对数字先转字符串再打码', () => {
    assert.equal(applyMask(13812348888, 'masked'), '138****8888');
  });

  it('masked 级别遇到非标量（对象/Buffer）整体隐藏，避免漏脱敏', () => {
    assert.equal(applyMask({ openid: 'x' }, 'masked'), MASK_PLACEHOLDER);
    assert.equal(applyMask(true, 'masked'), MASK_PLACEHOLDER);
  });

  it('none 级别返回原值', () => {
    assert.equal(applyMask('kevin', 'none'), 'kevin');
    assert.equal(applyMask(42, 'none'), 42);
  });

  it('null / undefined 不被打码', () => {
    assert.equal(applyMask(null, 'masked'), null);
    assert.equal(applyMask(undefined, 'hidden'), undefined);
  });
});

describe('maskRow', () => {
  it('按列级别逐字段脱敏', () => {
    const row = {
      id: 1,
      username: 'kevin_zhang',
      password: '$2b$10$secret',
      phone: '13812348888',
      email: 'kevin@example.com',
      created_at: '2026-09-01 14:22:07',
    };
    const levels = {
      id: 'none', username: 'none', password: 'hidden',
      phone: 'masked', email: 'masked', created_at: 'none',
    } as const;

    const out = maskRow(row, levels as unknown as Record<string, 'none' | 'hidden' | 'masked'>);

    assert.equal(out.id, 1);
    assert.equal(out.username, 'kevin_zhang');
    assert.equal(out.password, MASK_PLACEHOLDER);
    assert.equal(out.phone, '138****8888');
    assert.equal(out.email, 'k***@example.com');
    assert.equal(out.created_at, '2026-09-01 14:22:07');
  });

  it('未提供级别的列按 none 处理', () => {
    const out = maskRow({ nickname: 'amy' }, {});
    assert.equal(out.nickname, 'amy');
  });
});
