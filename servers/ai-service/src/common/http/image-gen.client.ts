import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';

export interface ImageSubmitRequest {
  model: string;
  prompt: string;
}

export interface ImageSubmitResponse {
  code: number;
  id: string;
  model: string;
  object: string;
  created: number;
}

export interface ImageQueryRequest {
  model: string;
  id: string;
}

export interface ImageQueryApiResponse {
  request_id: string;
  object: string;
  created_at: number;
  completed_at?: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  data?: Array<{
    url: string;
    revised_prompt?: string;
  }>;
  error?: {
    code: string;
    message: string;
  };
  usage?: {
    credits: number;
    duration: number;
  };
}

export interface ImageQueryResult {
  id: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  results?: Array<{
    url: string;
    revised_prompt?: string;
  }>;
  done: boolean;
}

@Injectable()
export class ImageGenClient {
  private readonly logger = new Logger(ImageGenClient.name);
  private readonly defaultModel = 'hy-image-v3.0';

  constructor(private readonly httpService: HttpService) {}

  /**
   * 提交图片生成任务
   */
  async submit(prompt: string): Promise<ImageSubmitResponse> {
    const baseUrl = process.env.IMAGE_GEN_BASE_URL || 'https://tokenhub.tencentmaas.com';
    const apiKey = process.env.IMAGE_GEN_API_KEY;

    if (!apiKey) {
      throw new Error('IMAGE_GEN_API_KEY is not configured');
    }

    const url = `${baseUrl}/v1/api/image/submit`;

    const payload: ImageSubmitRequest = {
      model: this.defaultModel,
      prompt,
    };

    this.logger.log(`Submitting image generation task: "${prompt.substring(0, 50)}..."`);

    try {
      const response: AxiosResponse = await firstValueFrom(
        this.httpService.post(url, payload, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }),
      );

      this.logger.log(`Image task submitted, id: ${response.data.id}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Image submit error: ${error.message}`);
      throw new Error(`图片生成提交失败: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * 查询图片生成结果
   */
  async query(taskId: string): Promise<ImageQueryResult> {
    const baseUrl = process.env.IMAGE_GEN_BASE_URL || 'https://tokenhub.tencentmaas.com';
    const apiKey = process.env.IMAGE_GEN_API_KEY;

    if (!apiKey) {
      throw new Error('IMAGE_GEN_API_KEY is not configured');
    }

    const url = `${baseUrl}/v1/api/image/query`;

    const payload: ImageQueryRequest = {
      model: this.defaultModel,
      id: taskId,
    };

    try {
      const response: AxiosResponse = await firstValueFrom(
        this.httpService.post(url, payload, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }),
      );

      const raw = response.data as ImageQueryApiResponse;

      // 映射状态
      const statusMap: Record<string, ImageQueryResult['status']> = {
        pending: 'pending',
        in_progress: 'running',
        completed: 'succeeded',
        failed: 'failed',
      };

      const mappedStatus = statusMap[raw.status] || 'running';

      return {
        id: taskId,
        status: mappedStatus,
        results: raw.data?.map((item) => ({
          url: item.url,
          revised_prompt: item.revised_prompt,
        })),
        done: raw.status === 'completed' || raw.status === 'failed',
      };
    } catch (error) {
      this.logger.error(`Image query error: ${error.message}`);
      throw new Error(`图片查询失败: ${error.response?.data?.message || error.message}`);
    }
  }
}
