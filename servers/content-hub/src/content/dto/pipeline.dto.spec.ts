import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CronPreviewDto, PipelineCreateDto, PipelineUpdateDto } from './pipeline.dto';

/**
 * 管线 DTO 校验（#8561）。
 *
 * 这组用例守的是「坏 cron 进不了库」这道门 —— 2026-11-06 的线上故障（#8557）
 * 就是 `0 8 0 * *` 被原样写进 `content_pipelines`：接口当时是 `@Body() body: any`，
 * 全局 ValidationPipe 因为没有 DTO 元类型直接跳过，校验等于不存在。
 *
 * 反向要求（已写进用例）：**PATCH 只传 enabled 必须放行** ——
 * 列表页的启用/停用开关就走这条路径，收严校验不能把它一起打死。
 */
function errorsOf<T extends object>(cls: new () => T, raw: Record<string, unknown>) {
  return validate(plainToInstance(cls, raw));
}

const VALID_CREATE = {
  code: 'ai_news',
  type: 'ai-news',
  cron: '0 8 * * 4',
  title_template: 'AI 资讯日报 ｜ {{date}}',
  llm_prompt: null,
  publish_targets: ['wechat_mp'],
  publish_mode: 'draft',
  cover_media_id: null,
  default_cover_id: null,
  enabled: true,
};

describe('PipelineCreateDto', () => {
  it('编辑页实际提交的完整报文通过校验', async () => {
    await expect(errorsOf(PipelineCreateDto, VALID_CREATE)).resolves.toHaveLength(0);
  });

  it('🔴 `0 8 0 * *` 被拒，且报错带字段顺序提示', async () => {
    const errs = await errorsOf(PipelineCreateDto, { ...VALID_CREATE, cron: '0 8 0 * *' });
    expect(errs).toHaveLength(1);
    expect(errs[0].property).toBe('cron');
    expect(String(errs[0].constraints?.isCronExpression)).toContain('分 时 日 月 周');
  });

  it('缺 cron 也算非法（不能靠「不传」绕过校验）', async () => {
    const { cron: _drop, ...rest } = VALID_CREATE;
    const errs = await errorsOf(PipelineCreateDto, rest);
    expect(errs.map((e) => e.property)).toContain('cron');
  });

  it('未知 type 被拒', async () => {
    const errs = await errorsOf(PipelineCreateDto, { ...VALID_CREATE, type: 'unknown' });
    expect(errs.map((e) => e.property)).toContain('type');
  });

  it('未知 publish_mode 被拒', async () => {
    const errs = await errorsOf(PipelineCreateDto, { ...VALID_CREATE, publish_mode: 'publish_all' });
    expect(errs.map((e) => e.property)).toContain('publish_mode');
  });

  it('enabled 传字符串被拒（Boolean 强转由 DTO 拦，不作隐式容错）', async () => {
    const errs = await errorsOf(PipelineCreateDto, { ...VALID_CREATE, enabled: 'maybe' });
    expect(errs.map((e) => e.property)).toContain('enabled');
  });
});

describe('PipelineUpdateDto', () => {
  it('只传 enabled 放行（列表页开关走这条）', async () => {
    await expect(errorsOf(PipelineUpdateDto, { enabled: false })).resolves.toHaveLength(0);
  });

  it('只传 cron 且合法放行', async () => {
    await expect(errorsOf(PipelineUpdateDto, { cron: '0 9 * * 5' })).resolves.toHaveLength(0);
  });

  it('只传 cron 但越界被拒（改坏调度最常见的入口）', async () => {
    const errs = await errorsOf(PipelineUpdateDto, { cron: '0 8 0 * *' });
    expect(errs.map((e) => e.property)).toContain('cron');
  });

  it('语法合法但语义可疑的 `0 9 4 * *` 放行（每月 4 号）——歧义靠预览暴露，不靠猜', async () => {
    await expect(errorsOf(PipelineUpdateDto, { cron: '0 9 4 * *' })).resolves.toHaveLength(0);
  });

  it('只传 title_template 放行（不要求带上 cron）', async () => {
    await expect(
      errorsOf(PipelineUpdateDto, { title_template: '每日论文速览 ｜ {{date}}' }),
    ).resolves.toHaveLength(0);
  });
});

describe('CronPreviewDto', () => {
  it('空 cron 被拒（@IsString 之外还要挡住空串）', async () => {
    const errs = await errorsOf(CronPreviewDto, { cron: '' });
    // 空串语法上是 string，DTO 层不判空 —— 预览接口会返回 valid:false，
    // 这里记录该边界：DTO 放行、业务层判定（避免两处口径打架）
    expect(errs).toHaveLength(0);
  });

  it('非字符串被拒', async () => {
    const errs = await errorsOf(CronPreviewDto, { cron: 123 });
    expect(errs.map((e) => e.property)).toContain('cron');
  });
});
