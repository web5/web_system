/**
 * 控制台（UI / JWT）通道的触发来源与审批通道（2026-10-27 防再犯 S1）。
 *
 * 钉死两件事：
 *  ① 提交缺省派生 `ui`，body 可带页面/会话标识；
 *  ② approve / reject 的审批通道记 `ui`（与 MCP 的 `mcp:<keyName>` 对齐归因）。
 */
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PipelineController } from './pipeline.controller';
import { PipelineService } from './pipeline.service';
import { DeployService } from '../deploy/deploy.service';

describe('PipelineController（UI 通道 triggerSource / 审批通道）', () => {
  let controller: PipelineController;
  let submit: jest.Mock;
  let approve: jest.Mock;
  let reject: jest.Mock;

  beforeEach(async () => {
    submit = jest.fn(async () => ({ jobId: 'job-1', status: 'pending' }));
    approve = jest.fn(async () => ({ id: 'job-1', status: 'approved' }));
    reject = jest.fn(async () => ({ id: 'job-1', status: 'rejected' }));

    const moduleRef = await Test.createTestingModule({
      controllers: [PipelineController],
      providers: [
        {
          provide: PipelineService,
          useValue: {
            submit,
            approve,
            reject,
            cancel: jest.fn(),
            promote: jest.fn(),
            retry: jest.fn(),
            list: jest.fn(),
            get: jest.fn(),
            remove: jest.fn(),
            listApprovers: jest.fn(),
            listBranchCommits: jest.fn(),
            listReleaseCandidates: jest.fn(),
            listTemplateSummaries: jest.fn(),
          },
        },
        {
          provide: DeployService,
          useValue: { listModules: jest.fn(), getCurrentVersions: jest.fn() },
        },
      ],
    }).compile();

    controller = moduleRef.get(PipelineController);
  });

  const user = { username: 'alice' };

  it('缺省派生 triggerSource=ui', async () => {
    await controller.submit(
      { env: 'dev', moduleKey: 'admin' } as any,
      user as any,
    );
    expect(submit.mock.calls[0][0].triggerSource).toBe('ui');
    expect(submit.mock.calls[0][1]).toBe('alice');
  });

  it('body 带页面/会话标识则透传', async () => {
    await controller.submit(
      { env: 'dev', moduleKey: 'admin', triggerSource: 'page-releases' } as any,
      user as any,
    );
    expect(submit.mock.calls[0][0].triggerSource).toBe('page-releases');
  });

  it('非法 triggerSource 直接 400（不进服务层）', async () => {
    await expect(
      controller.submit(
        { env: 'dev', moduleKey: 'admin', triggerSource: 'bad source' } as any,
        user as any,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(submit).not.toHaveBeenCalled();
  });

  it('approve / reject 审批通道记 ui', async () => {
    await controller.approve('job-1', { comment: 'ok' } as any, user as any);
    expect(approve.mock.calls[0][4]).toBe('ui');

    await controller.reject('job-1', { comment: 'no' } as any, user as any);
    expect(reject.mock.calls[0][4]).toBe('ui');
  });

  it('reject 仍强制填意见', async () => {
    await expect(
      controller.reject('job-1', {} as any, user as any),
    ).rejects.toThrow(/拒绝必须填写审批意见/);
    expect(reject).not.toHaveBeenCalled();
  });
});
