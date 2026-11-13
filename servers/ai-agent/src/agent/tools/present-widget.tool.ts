import { Injectable } from '@nestjs/common';
import { ToolDefinition, ToolContext, ToolResult, ToolSchema } from '@kedouai/agent-core';

/** 组件白名单（纵深防御第一层：LLM 只能三选一，schema enum 是提示、这里才是强制） */
const WIDGET_APPS = ['poll', 'chart', 'form'] as const;
type WidgetApp = (typeof WIDGET_APPS)[number];

/** 原型污染键：清洗时整键剔除（含嵌套），防 props 携带 __proto__ 等污染下游对象 */
const PROTO_POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isWidgetApp(value: unknown): value is WidgetApp {
  return typeof value === 'string' && (WIDGET_APPS as readonly string[]).includes(value);
}

/**
 * 递归剔除原型污染键；非对象原样返回（JSON 标量）。
 * 只做「键名过滤」这一种清洗——props 语义由 LLM 负责，服务端不猜业务字段。
 */
function sanitizeProps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeProps);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (PROTO_POLLUTION_KEYS.has(key)) continue;
      out[key] = sanitizeProps(v);
    }
    return out;
  }
  return value;
}

/**
 * 产出「交互组件」指令（poll 投票 / chart 图表 / form 表单）。
 *
 * 工具本身只构造并校验 `{app, props}` 载荷：服务端先验 app 白名单（纵深防御），
 * props 做原型污染键清洗。execute 返回的 JSON 与 mock 的 widget fence spec 同构，
 * 由 demo-backend 转译层收口成正文流里的 ```widget fence（controller 零改）。
 *
 * 入参非法时**直接抛错**：ToolRegistry 会转成 `{success:false, error}`，
 * 引擎以「工具执行失败」回喂 LLM（自行降级为文本），转译层也不同步 fence。
 */
@Injectable()
export class PresentWidgetTool implements ToolDefinition {
  readonly name = 'present-widget';
  readonly description =
    '向用户展示一个交互组件（三选一：poll=投票、chart=图表、form=表单）。' +
    '当用户要做选择/表决、对比数据、或需要填写输入时使用；props 只传 JSON 展示数据' +
    '（如 poll 的 {question, options:[{id,label,votes}]}，chart 的 {title, labels, names, series}，' +
    'form 的 {placeholder, schema?}），不要传函数或事件句柄。其余普通问答不要调用本工具。';
  readonly parameters = {
    app: {
      type: 'string' as const,
      description: '组件类型，只能三选一：poll（投票）/ chart（图表）/ form（表单）',
      required: true,
      enum: [...WIDGET_APPS],
    },
    props: {
      type: 'object' as const,
      description:
        '组件初始展示 props（JSON 数据）。poll: {question, options:[{id,label,votes}]}；' +
        'chart: {title, labels, names, series}；form: {placeholder, schema?}。只放展示数据',
      required: true,
    },
  };

  toSchema(): ToolSchema {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: 'object',
          properties: {
            app: { type: 'string', description: '组件类型', enum: [...WIDGET_APPS] },
            props: { type: 'object', description: '组件初始展示 props（JSON 数据）' },
          },
          required: ['app', 'props'],
        },
      },
    };
  }

  async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    // 白名单强制校验（schema enum 只是提示，LLM 仍可能越界；这里不合法直接抛错）
    if (!isWidgetApp(args.app)) {
      throw new Error(
        `present-widget: app 必须是 ${WIDGET_APPS.join(' / ')} 之一，收到 ${JSON.stringify(args.app)}`,
      );
    }

    const props = args.props;
    if (props === null || typeof props !== 'object' || Array.isArray(props)) {
      throw new Error('present-widget: props 必须是 JSON 对象（组件初始展示数据）');
    }

    // 先验可序列化（环状引用 / BigInt 等在此拦截）：既避免 sanitizeProps 对环状
    // 结构无限递归炸栈，也保证后续 stringify 只可能成功（清洗仅删键，不引入环）
    try {
      JSON.stringify(props);
    } catch (e) {
      throw new Error(`present-widget: props 不可 JSON 序列化（${(e as Error).message}）`);
    }

    const cleanProps = sanitizeProps(props) as Record<string, unknown>;
    return { success: true, content: JSON.stringify({ app: args.app, props: cleanProps }) };
  }
}
