import type { AguiEvent } from './agui-types';

export interface SseClientOptions {
  endpoint: string;
  method?: 'GET' | 'POST';
  /** AGUI 网关鉴权头 */
  mcpKey?: string;
  headers?: Record<string, string>;
  /** 控制中断（对应「停止生成」） */
  signal?: AbortSignal;
  /** 解析出单个 AGUI 事件后回调（由调用方决定是直渲还是经事件总线广播） */
  onEvent: (event: AguiEvent) => void;
  onOpen?: () => void;
  onError?: (err: Error) => void;
  onDone?: () => void;
}

/**
 * 真实 SSE / AGUI 客户端：用 fetch + ReadableStream 逐块读取 HTTP 流，
 * 解析 `data:` 行并反序列化为 AGUI 事件回调。不是 setTimeout 假流。
 *
 * 支持：
 * - 可配置 endpoint
 * - 自定义请求头（含 X-Mcp-Key 鉴权）
 * - 断点续读（按 `\n\n` 切分事件帧，不完整尾部留在 buffer）
 * - AbortSignal 取消
 */
export async function connectSse(opts: SseClientOptions): Promise<void> {
  const {
    endpoint,
    method = 'POST',
    mcpKey,
    headers = {},
    signal,
    onEvent,
    onOpen,
    onError,
    onDone,
  } = opts;

  const finalHeaders: Record<string, string> = {
    Accept: 'text/event-stream',
    ...headers,
  };
  if (mcpKey) finalHeaders['X-Mcp-Key'] = mcpKey;
  if (method === 'POST') finalHeaders['Content-Type'] = 'application/json';

  try {
    const res = await fetch(endpoint, {
      method,
      headers: finalHeaders,
      body: method === 'POST' ? '{}' : undefined,
      signal,
    });

    if (!res.ok || !res.body) {
      throw new Error(`SSE 连接失败: ${res.status} ${res.statusText}`);
    }

    onOpen?.();

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // 一个 SSE 事件帧以空行（\n\n）结尾
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const rawFrame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        const dataLines = rawFrame
          .split('\n')
          .filter((line) => line.startsWith('data:'));

        for (const line of dataLines) {
          const payload = line.slice(5).replace(/^ /, '');
          if (!payload) continue;
          try {
            const evt = JSON.parse(payload) as AguiEvent;
            onEvent(evt);
          } catch {
            // 跳过无法解析的帧（心跳/注释等）
          }
        }
      }
    }

    onDone?.();
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    onError?.(err as Error);
  }
}
