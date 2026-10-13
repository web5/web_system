import { mdToNodes, mdToPlain } from '../utils/markdown';
import type { MdChild, MdNode, MdTextNode } from '../utils/markdown';

/**
 * markdown → rich-text nodes 的回归测试。
 *
 * 重点守住两个坑：
 * 1. **children 里混进裸字符串** —— rich-text 会静默丢弃，表现为「AI 回复整片空白」。
 *    官方 nodes 格式要求文本必须包成 { type: 'text', text }，见 assertNoBareString。
 * 2. **流式降级** —— AI 是一边吐字一边全量重解析的，未闭合的 ** / ` / 围栏必须原样输出，
 *    不能把半成品吞掉或误判成代码块。
 */

/* ================= 断言工具 ================= */

const isText = (n: MdChild): n is MdTextNode => (n as MdTextNode).type === 'text';

/** 递归收集所有文本内容（忽略样式与结构，只看"说了什么"） */
function flatText(nodes: MdChild[]): string {
  return nodes
    .map((n) => {
      if (isText(n)) return n.text;
      const el = n as MdNode;
      return el.children ? flatText(el.children) : '';
    })
    .join('');
}

/** 递归收集所有元素的 style 串 */
function flatStyle(nodes: MdChild[]): string {
  return nodes
    .map((n) => {
      if (isText(n)) return '';
      const el = n as MdNode;
      return `${el.attrs?.style || ''}${el.children ? flatStyle(el.children) : ''}`;
    })
    .join('');
}

/** 递归收集所有元素名 */
function flatNames(nodes: MdChild[]): string[] {
  const out: string[] = [];
  const walk = (list: MdChild[]) => {
    list.forEach((n) => {
      if (isText(n)) return;
      const el = n as MdNode;
      out.push(el.name);
      if (el.children) walk(el.children);
    });
  };
  walk(nodes);
  return out;
}

/**
 * 结构断言：任何 children 里的元素都不得是裸字符串。
 * 这是本项目踩过的最疼的坑（早期实现把 buf / codeLine 直接塞 children，
 * rich-text 静默丢弃 → AI 气泡一片空白），必须守住。
 */
function assertNoBareString(nodes: MdChild[], path = 'root'): void {
  nodes.forEach((n, idx) => {
    const at = `${path}[${idx}]`;
    // 裸字符串是最容易溜进来的形态：typeof 直接判
    expect(typeof n).not.toBe('string');
    if (isText(n)) {
      expect(typeof n.text).toBe('string');
      return;
    }
    const el = n as MdNode;
    expect(typeof el.name).toBe('string');
    if (el.children) assertNoBareString(el.children, `${at}.${el.name}`);
  });
}

/** 跑一遍 mdToNodes 并做结构断言（每个用例都过） */
function render(src: string): MdNode[] {
  const nodes = mdToNodes(src);
  assertNoBareString(nodes as MdChild[]);
  return nodes;
}

/* ================= mdToNodes ================= */

describe('mdToNodes · 基础', () => {
  it('空输入 → 空数组（空态气泡不该有残留节点）', () => {
    expect(mdToNodes('')).toEqual([]);
  });

  it('纯文本：一个段落 div，文本原样保真', () => {
    const nodes = render('你好，这是一段普通回复。');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].name).toBe('div');
    expect(flatText(nodes)).toBe('你好，这是一段普通回复。');
  });

  it('HTML 特殊字符按纯文本渲染（不解析、不转义错乱）', () => {
    const nodes = render('a < b 且 c > d，& 也要保留');
    expect(flatText(nodes)).toContain('a < b');
    expect(flatText(nodes)).toContain('&');
  });

  it('段落内换行用 br 连接（不拆成两个 div）', () => {
    const nodes = render('第一行\n第二行');
    expect(nodes).toHaveLength(1);
    expect(flatNames(nodes)).toContain('br');
    expect(flatText(nodes)).toContain('第一行');
    expect(flatText(nodes)).toContain('第二行');
  });

  it('空行分隔 → 两个段落 div', () => {
    const nodes = render('第一段\n\n第二段');
    expect(nodes).toHaveLength(2);
    expect(flatText([nodes[0]])).toBe('第一段');
    expect(flatText([nodes[1]])).toBe('第二段');
  });
});

describe('mdToNodes · 标题', () => {
  it('# 一级标题：文字保真 + 加粗 + 品牌色', () => {
    const nodes = render('# 一句话结论');
    expect(flatText(nodes)).toBe('一句话结论');
    expect(flatStyle(nodes)).toContain('font-weight:600');
    expect(flatStyle(nodes)).toContain('#EA580C');
  });

  it('## 二级标题', () => {
    expect(flatText(render('## 小标题'))).toBe('小标题');
  });

  it('### 三级标题：不再带品牌色（只有 h1 上色）', () => {
    const style = flatStyle(render('### 三级'));
    expect(style).toContain('font-weight:600');
    expect(style).not.toContain('#EA580C');
  });

  it('标题里的行内标记照样解析', () => {
    expect(flatStyle(render('## 结论 **很重要**'))).toContain('font-weight:600');
  });

  it('# 后无空格不算标题（按普通段落渲染）', () => {
    const nodes = render('#话题标签');
    expect(flatText(nodes)).toBe('#话题标签');
  });
});

describe('mdToNodes · 行内标记', () => {
  it('加粗 **x** → 内容保真 + 600 字重', () => {
    const nodes = render('这是**重点**内容');
    expect(flatText(nodes)).toBe('这是重点内容');
    expect(flatStyle(nodes)).toContain('font-weight:600');
  });

  it('加粗 __x__ 与 **x** 等价', () => {
    expect(flatText(render('这是__重点__内容'))).toBe('这是重点内容');
  });

  it('斜体 *x* → italic', () => {
    const nodes = render('这是 *强调* 内容');
    expect(flatText(nodes)).toBe('这是 强调 内容');
    expect(flatStyle(nodes)).toContain('font-style:italic');
  });

  it('删除线 ~~x~~ → line-through', () => {
    const nodes = render('原价 ~~199~~ 现价 99');
    expect(flatText(nodes)).toContain('199');
    expect(flatStyle(nodes)).toContain('line-through');
  });

  it('行内代码 `x` → 等宽字体，且代码里的 * 不再解析', () => {
    const nodes = render('用 `npm run build` 打包');
    expect(flatText(nodes)).toContain('npm run build');
    expect(flatStyle(nodes)).toContain('monospace');
  });

  it('链接 [文字](url) → 只出文字，url 不进文本（rich-text 的 a 点不了，露 url 是误导）', () => {
    const nodes = render('详见[官方文档](https://example.com/docs)');
    const text = flatText(nodes);
    expect(text).toContain('官方文档');
    expect(text).not.toContain('https://');
  });

  it('图片 ![alt](url) → 弱化为 [图片:alt] 标记文本', () => {
    expect(flatText(render('![封面](https://x/y.png)'))).toBe('[图片:封面]');
  });
});

describe('mdToNodes · 块级', () => {
  it('围栏代码块：正文保真，围栏行本身不渲染', () => {
    const nodes = render('```\nconst a = 1;\nconst b = 2;\n```');
    const text = flatText(nodes);
    expect(text).toContain('const a = 1;');
    expect(text).toContain('const b = 2;');
    expect(text).not.toContain('```');
    expect(flatStyle(nodes)).toContain('monospace');
  });

  it('代码块内多行用 br 连接', () => {
    expect(flatNames(render('```\nline1\nline2\n```'))).toContain('br');
  });

  it('未配对的围栏不生效（流式降级：按普通段落渲染，不吞内容）', () => {
    const nodes = render('```\n还没写完的代码');
    expect(flatText(nodes)).toContain('还没写完的代码');
    expect(flatStyle(nodes)).not.toContain('monospace');
  });

  it('无序列表：每项带项目符号 •', () => {
    const nodes = render('- 第一点\n- 第二点');
    const text = flatText(nodes);
    expect(text).toContain('第一点');
    expect(text).toContain('第二点');
    expect(text).toContain('•');
    expect(nodes.length).toBeGreaterThanOrEqual(2);
  });

  it('有序列表：自动编号（不依赖源文本写的数字）', () => {
    const text = flatText(render('3. 第三点\n7. 第七点'));
    expect(text).toContain('1.');
    expect(text).toContain('2.');
  });

  it('引用块：连续 > 行合并为一个块', () => {
    const nodes = render('> 第一句\n> 第二句');
    expect(nodes).toHaveLength(1);
    expect(flatText(nodes)).toContain('第一句');
    expect(flatText(nodes)).toContain('第二句');
    expect(flatStyle(nodes)).toContain('border-left');
  });

  it('分隔线：独立 div，无文本子节点', () => {
    const nodes = render('上文\n\n---\n\n下文');
    const hr = nodes.find((n) => (n.attrs?.style || '').includes('height:1px'));
    expect(hr).toBeTruthy();
    expect(flatText([hr as MdNode])).toBe('');
  });

  it('表格：表头 + 数据行，单元格文本齐全', () => {
    const nodes = render('| 项目 | 金额 |\n| --- | --- |\n| 月供 | 3200 |');
    const text = flatText(nodes);
    expect(text).toContain('项目');
    expect(text).toContain('金额');
    expect(text).toContain('3200');
    expect(text).not.toContain('---');
  });
});

describe('mdToNodes · 流式降级与混合', () => {
  it('未闭合的 ** 原样输出（不吞字、不乱套样式）', () => {
    const nodes = render('正在生成**重点内容');
    expect(flatText(nodes)).toContain('**');
    expect(flatText(nodes)).toContain('重点内容');
  });

  it('未闭合的行内反引号原样输出', () => {
    expect(flatText(render('代码 `const a'))).toContain('`const a');
  });

  it('未闭合的删除线原样输出', () => {
    expect(flatText(render('价格 ~~199'))).toContain('~~199');
  });

  it('未闭合的链接按普通文本输出（url 不外泄规则同样成立）', () => {
    expect(flatText(render('详见[官方文档](https://example.com'))).toContain('[官方文档]');
  });

  it('混合排版：标题 + 列表 + 代码块 + 引用依次输出，顺序不乱', () => {
    const src = ['# 结论', '', '- 要点一', '- 要点二', '', '```', 'npm i', '```', '', '> 备注'].join(
      '\n',
    );
    const nodes = render(src);
    const text = flatText(nodes);
    expect(text).toContain('结论');
    expect(text).toContain('要点一');
    expect(text).toContain('npm i');
    expect(text).toContain('备注');
    expect(nodes.length).toBeGreaterThanOrEqual(5);
  });

  it('真实回答形态（标题+加粗+列表+表格混排）不丢内容', () => {
    const src = [
      '## 结论先行',
      '',
      '这笔贷款**可以办**，但要注意 **两点**：',
      '',
      '1. 实际年化 15.4%',
      '2. 提前还款有违约金',
      '',
      '| 项 | 值 |',
      '| --- | --- |',
      '| 年化 | 15.4% |',
    ].join('\n');
    const text = flatText(render(src));
    expect(text).toContain('结论先行');
    expect(text).toContain('可以办');
    expect(text).toContain('15.4%');
    expect(text).toContain('提前还款有违约金');
  });
});

/* ================= mdToPlain ================= */

describe('mdToPlain（朗读 / 复制用）', () => {
  it('语法符号不能进 TTS：去标记留内容', () => {
    expect(mdToPlain('这是**重点**和 `代码`')).toBe('这是重点和 代码');
  });

  it('标题与列表前缀转成可读形式', () => {
    const plain = mdToPlain('# 结论\n\n- 要点');
    expect(plain).toContain('结论');
    expect(plain).toContain('• 要点');
    expect(plain).not.toContain('#');
  });

  it('链接取文字、图片取 alt（url 不念出来）', () => {
    expect(mdToPlain('见[文档](https://a.com/b) 图![封面](https://a/c.png)')).toBe(
      '见文档 图[图片:封面]',
    );
  });

  it('分隔线整行丢掉，代码块内容保真（复制要能粘回代码）', () => {
    const plain = mdToPlain('上文\n\n---\n\n```\nconst a = 1;\n```');
    expect(plain).not.toContain('---');
    expect(plain).toContain('const a = 1;');
    expect(plain).not.toContain('```');
  });

  it('表格竖线换空格，不留排版符号', () => {
    expect(mdToPlain('| 月供 | 3200 |')).toBe('月供 3200');
  });

  it('空输入 → 空串', () => {
    expect(mdToPlain('')).toBe('');
    expect(mdToPlain('   ')).toBe('');
  });
});

/* ================= 结构兜底 ================= */

describe('结构兜底（rich-text 节点格式）', () => {
  const samples = [
    '# 标题',
    '普通段落',
    '**粗** *斜* ~~删~~ `码`',
    '- 项一\n- 项二',
    '1. 项一\n2. 项二',
    '> 引用',
    '---',
    '```\ncode\n```',
    '```\n未闭合',
    '| a | b |\n| --- | --- |\n| 1 | 2 |',
    '[链接](https://x.com) 与 ![图](https://x/y.png)',
    '**未闭合',
  ];

  it.each(samples)('产出树种不含裸字符串：%j', (src) => {
    assertNoBareString(mdToNodes(src) as MdChild[]);
  });

  it('元素名只用白名单（div / span / br）', () => {
    const names = new Set(flatNames(mdToNodes(samples.join('\n\n')) as MdChild[]));
    names.forEach((n) => expect(['div', 'span', 'br']).toContain(n));
  });
});
