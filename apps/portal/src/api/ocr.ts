/**
 * OCR 图片识别 — API（Portal 端）
 *
 * 经 gateway 转发：`POST /api/ai-agent/ocr/recognize` → ai-agent `/ocr/recognize`。
 * 只支持**图片**（Q11：PDF / Word 解析本轮不做）；服务端已用 LLM 清洗页眉页脚噪声，
 * 返回的 text 是可直接送分析的合同正文。
 */
import request from './request';

export interface OcrResult {
  /** 清洗后的合同正文 */
  text: string;
  /** 清洗后有效文本块数量 */
  blockCount: number;
}

/**
 * 识别合同图片文字。
 * @param imageBase64 图片 base64（不含 `data:image/...;base64,` 前缀）
 * @param scene 可选合同场景，用于辅助清洗
 */
export async function recognizeOcr(imageBase64: string, scene?: string): Promise<OcrResult> {
  const data = await request.post(
    '/ai-agent/ocr/recognize',
    { imageBase64, ...(scene ? { scene } : {}) },
    { timeout: 60000 },
  );
  const body = (data ?? {}) as Partial<OcrResult>;
  return { text: body.text ?? '', blockCount: body.blockCount ?? 0 };
}

/** 读取图片文件为 base64（去掉 data URL 前缀，与小程序 OCR 入参口径一致） */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result ?? '');
      resolve(raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw);
    };
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}
