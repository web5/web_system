/**
 * 原生 fetch HTTP 封装（零第三方依赖）。
 * - postJson：JSON POST，超时用 AbortSignal.timeout
 * - streamSse：SSE 流式读取（供 chatStream 用）
 */

export interface FetchHttpOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface SseEvent {
  data: string;
  done: boolean;
}

async function buildInit(
  method: string,
  payload: unknown,
  options: FetchHttpOptions = {},
): Promise<{ init: RequestInit; timeoutMs: number }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers ?? {}),
  };
  const timeoutMs = options.timeoutMs ?? 30_000;
  const init: RequestInit = {
    method,
    headers,
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  };
  return { init, timeoutMs };
}

async function assertOk(resp: Response): Promise<void> {
  if (!resp.ok) {
    let detail = '';
    try {
      detail = await resp.text();
    } catch {
      detail = '';
    }
    const err: any = new Error(`HTTP ${resp.status} ${resp.statusText}`);
    err.status = resp.status;
    err.responseBody = detail;
    throw err;
  }
}

/** 非流式 JSON POST */
export async function postJson<T = any>(
  url: string,
  payload: unknown,
  options: FetchHttpOptions = {},
): Promise<T> {
  const { init } = await buildInit('POST', payload, options);
  const resp = await fetch(url, init);
  await assertOk(resp);
  return (await resp.json()) as T;
}

/** SSE 流式 POST：逐事件 yield { data, done } */
export async function* streamSse(
  url: string,
  payload: unknown,
  options: FetchHttpOptions = {},
): AsyncGenerator<SseEvent, void, unknown> {
  const { init } = await buildInit('POST', payload, options);
  const resp = await fetch(url, init);
  await assertOk(resp);
  if (!resp.body) {
    yield { data: '', done: true };
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') {
        yield { data: '', done: true };
        return;
      }
      yield { data, done: false };
    }
  }
}
