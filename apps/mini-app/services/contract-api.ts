/**
 * 合同翻译官 - AI 分析 API
 * 调用 ai-agent 服务的 agent 编排接口（SSE 流式），聚合最终风险报告。
 *
 * 链路：小程序 → gateway(/api/ai-agent/agent/run) → ai-agent(/agent/run) → agent-core
 */
import { getToken } from '../utils/request';

const AGENT_RUN_URL = '/api/ai-agent/agent/run';
const AGENT_ID = 'contract-risk';

/** SSE 事件类型（与 agent-core StreamEvent 对齐） */
interface StreamEvent {
  type: 'start' | 'tool_call' | 'tool_result' | 'final' | 'error';
  content?: string;
  name?: string;
  conversationId?: string;
}

/** 合同风险报告 */
export interface ContractReport {
  scene: string;
  conclusion: string;
  signals: Array<{
    id: string;
    name: string;
    level: 'danger' | 'warn' | 'ok';
    signalTitle: string;
    plainText: string;
    legalBasis: { law: string; article: string; quote: string };
    actions: string[];
    termExplain?: string;
  }>;
  disclaimer: string;
  createdAt: number;
}

/**
 * 分析合同，返回结构化风险报告。
 * @param text 合同文本（OCR/粘贴）
 * @param scene 可选场景
 */
export function analyzeContract(text: string, scene?: string): Promise<ContractReport> {
  return new Promise((resolve, reject) => {
    const app = getApp<IAppOption>();
    const baseUrl = app.globalData.apiBase;
    const token = getToken();

    const userInput = scene
      ? `【合同场景】${scene}\n【合同内容】\n${text}\n\n请识别这份合同的风险，输出结构化风险报告。`
      : `【合同内容】\n${text}\n\n请判断合同类型并识别风险，输出结构化风险报告。`;

    const task = wx.request({
      url: `${baseUrl}${AGENT_RUN_URL}`,
      method: 'POST',
      data: { agentId: AGENT_ID, userInput },
      enableChunked: true,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      timeout: 300000, // agent 编排 + IRR + LLM 多步，超时调到 5 分钟
      success: () => {
        // 流式结果通过 onChunkReceived 处理
      },
      fail: (err) => {
        reject(new Error(err.errMsg || '网络请求失败'));
      },
    });

    // 每个请求独立的 SSE 缓冲区
    let buffer = '';

    // 接收流式 chunk，解析 SSE 事件
    (task as any).onChunkReceived((res: any) => {
      try {
        const chunk = res.data;
        const text = typeof chunk === 'string' ? chunk : String(chunk);
        buffer = parseSseEvents(buffer, text, resolve, reject);
      } catch (e) {
        reject(e);
      }
    });
  });
}

/** 解析 SSE 事件流，聚合到 final 事件；返回剩余未完成缓冲区 */
function parseSseEvents(
  buffer: string,
  chunk: string,
  resolve: (v: ContractReport) => void,
  reject: (e: Error) => void,
): string {
  buffer += chunk;
  // 按 data: 行切分
  const lines = buffer.split('\n');
  buffer = lines.pop() || ''; // 保留最后一个不完整行

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.substring(5).trim();
    if (!payload) continue;

    try {
      const event = JSON.parse(payload) as StreamEvent;
      if (event.type === 'error') {
        reject(new Error(event.content || '分析失败'));
      } else if (event.type === 'final') {
        const report = parseReport(event.content || '');
        resolve(report);
      }
    } catch {
      // 忽略非 JSON 行
    }
  }
  return buffer;
}

/** 从 agent final 内容解析结构化报告（LLM 输出 JSON 文本，提取/兜底） */
function parseReport(content: string): ContractReport {
  const trimmed = content.trim();
  // 尝试直接解析 JSON
  try {
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.signals || parsed.conclusion) {
        return {
          scene: parsed.scene || '未知',
          conclusion: parsed.conclusion || '分析完成',
          signals: parsed.signals || [],
          disclaimer: parsed.disclaimer || '仅用于理解合同，不构成法律/理财/投资建议。',
          createdAt: Date.now(),
        };
      }
    }
  } catch {
    // 非 JSON，走兜底
  }

  // 兜底：把 LLM 文本作为结论展示
  return {
    scene: '未知',
    conclusion: trimmed,
    signals: [],
    disclaimer: '仅用于理解合同，不构成法律/理财/投资建议。',
    createdAt: Date.now(),
  };
}
