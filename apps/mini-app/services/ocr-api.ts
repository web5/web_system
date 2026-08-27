/**
 * 合同翻译官 - OCR API
 * 调 ai-agent 的 OCR 服务识别合同图片文字。
 */
import { getToken } from '../utils/request';

const OCR_URL = '/api/ai-agent/ocr/recognize';

export interface OcrResult {
  text: string;
  blockCount: number;
}

/**
 * 选择图片并 OCR 识别文字。
 * @param sourceType 图片来源：camera / album
 */
export function chooseAndRecognize(sourceType: 'camera' | 'album'): Promise<OcrResult> {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: [sourceType],
      sizeType: ['compressed'],
      success: (res) => {
        const file = res.tempFiles?.[0];
        if (!file?.tempFilePath) {
          reject(new Error('未获取到图片'));
          return;
        }
        // 读为 base64
        wx.getFileSystemManager().readFile({
          filePath: file.tempFilePath,
          encoding: 'base64',
          success: (readRes) => {
            recognizeBase64(readRes.data as string)
              .then(resolve)
              .catch(reject);
          },
          fail: () => reject(new Error('读取图片失败')),
        });
      },
      fail: (err) => {
        // 用户取消选择，不报错
        reject(err);
      },
    });
  });
}

/** 上传 base64 图片到 OCR 服务识别 */
function recognizeBase64(imageBase64: string, scene?: string): Promise<OcrResult> {
  return new Promise((resolve, reject) => {
    const app = getApp<IAppOption>();
    const baseUrl = app.globalData.apiBase;
    const token = getToken();

    wx.request({
      url: `${baseUrl}${OCR_URL}`,
      method: 'POST',
      data: { imageBase64, scene },
      timeout: 30000,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      success: (res) => {
        const data = res.data as any;
        // 兼容 2xx（NestJS POST 默认 201 Created，部分接口返回 200 OK）
        const isHttpOk = res.statusCode >= 200 && res.statusCode < 300;
        if (isHttpOk && data?.code === 0 && data?.data) {
          resolve({
            text: data.data.text || '',
            blockCount: data.data.blockCount || 0,
          });
        } else {
          reject(new Error(data?.message || 'OCR 识别失败'));
        }
      },
      fail: () => reject(new Error('网络请求失败')),
    });
  });
}
