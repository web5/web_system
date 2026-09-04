import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { assertReadOnlySql, MAX_ROWS } from './sql-guard';

/** 断言该 SQL 被拒绝 */
function assertRejected(sql: string, match?: string) {
  assert.throws(
    () => assertReadOnlySql(sql),
    (err: unknown) => {
      assert.ok(err instanceof BadRequestException, `应抛 BadRequestException，实际：${String(err)}`);
      if (match) {
        assert.match((err as BadRequestException).message, new RegExp(match, 'i'));
      }
      return true;
    },
  );
}

describe('assertReadOnlySql · 放行', () => {
  it('基础 SELECT 被包裹并追加 LIMIT', () => {
    const out = assertReadOnlySql('SELECT * FROM users');
    assert.equal(out, `SELECT * FROM (SELECT * FROM users) AS _ws_t LIMIT ${MAX_ROWS}`);
  });

  it('自带 LIMIT 小于上限时语义不变（外层再包一层不影响结果行数）', () => {
    const out = assertReadOnlySql('SELECT id FROM users LIMIT 10');
    assert.match(out, /LIMIT 10\)\s+AS _ws_t LIMIT 200/i);
  });

  it('自带 LIMIT 超过上限时被外层截断到 200', () => {
    const out = assertReadOnlySql('SELECT id FROM users LIMIT 5000');
    assert.match(out, /LIMIT 5000\)\s+AS _ws_t LIMIT 200/i);
  });

  it('自带 OFFSET 不被破坏（这是"替换 LIMIT"方案会踩的坑）', () => {
    const out = assertReadOnlySql('SELECT id FROM users LIMIT 10 OFFSET 20');
    assert.match(out, /LIMIT 10 OFFSET 20\)\s+AS _ws_t LIMIT 200/i);
  });

  it('末尾分号被容忍', () => {
    const out = assertReadOnlySql('SELECT 1;');
    assert.equal(out, `SELECT * FROM (SELECT 1) AS _ws_t LIMIT ${MAX_ROWS}`);
  });

  it('大小写不敏感', () => {
    const out = assertReadOnlySql('select id from users');
    assert.match(out, /^SELECT \* FROM \(select id from users\) AS _ws_t LIMIT 200$/);
  });

  it('JOIN / WHERE / GROUP BY / ORDER BY 正常放行', () => {
    const sql =
      'SELECT u.id, COUNT(t.id) AS c FROM users u LEFT JOIN ai_tasks t ON t.user_id = u.id WHERE u.status = 1 GROUP BY u.id ORDER BY c DESC';
    assert.match(assertReadOnlySql(sql), /^SELECT \* FROM \(/);
  });
});

describe('assertReadOnlySql · 拒绝', () => {
  it('空 SQL', () => {
    assertRejected('', '不能为空');
    assertRejected('   ', '不能为空');
  });

  it('非 SELECT 开头', () => {
    assertRejected('UPDATE users SET enabled = 0', '仅允许');
    assertRejected('DROP TABLE users', '仅允许');
    assertRejected('SHOW TABLES', '仅允许');
  });

  it('多语句注入（优先于关键词检测命中）', () => {
    assertRejected('SELECT 1; DROP TABLE users', '单条');
    assertRejected('SELECT 1; SELECT 2', '单条');
    assertRejected('SELECT * FROM users; INSERT INTO users VALUES (1)', '单条');
  });

  it('注释绕过', () => {
    assertRejected('SELECT 1 -- 注释', '注释');
    assertRejected('SELECT 1 /* x */', '注释');
    assertRejected('SELECT 1 # c', '注释');
  });

  it('危险关键词（纵深防御：SELECT 语句内出现即拦截，宁可保守）', () => {
    assertRejected('SELECT SLEEP(10)', 'SLEEP');
    assertRejected('SELECT * FROM users INTO OUTFILE "/tmp/x"', 'INTO OUTFILE');
    assertRejected("SELECT * FROM users WHERE name = 'update'", 'UPDATE');
    assertRejected('SELECT * FROM users WHERE name = "drop"', 'DROP');
    assertRejected('SELECT * FROM users WHERE id = 1 AND SET(x)', 'SET');
  });

  it('mysql 系统库', () => {
    assertRejected('SELECT * FROM mysql.user', '系统库');
  });
});

describe('assertReadOnlySql · 不误伤', () => {
  it('含关键词子串的合法内容不被误杀', () => {
    // deleted / offset / asset 内含 delete / set，但词边界不成立
    assert.doesNotThrow(() => assertReadOnlySql("SELECT * FROM users WHERE status = 'deleted'"));
    assert.doesNotThrow(() => assertReadOnlySql('SELECT id FROM users LIMIT 10 OFFSET 5'));
    assert.doesNotThrow(() => assertReadOnlySql("SELECT * FROM materials WHERE name LIKE '%asset%'"));
  });
});
