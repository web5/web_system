import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import {
  buildServer,
  createHttpModule,
  createJobStatusModule,
  callApi,
  executeJob,
  HttpModuleConfig,
  HttpToolDef,
  HttpJobToolDef,
} from '@web-system/mcp-core';
import { McpModuleEntity } from './entities/mcp-module.entity';
import { McpToolEntity } from './entities/mcp-tool.entity';
import { McpJobEntity } from './entities/mcp-job.entity';

/**
 * 稳定序列化：对象键按字典序输出，用于判断"声明有没有变"。
 *
 * 为什么不能直接 `JSON.stringify(a) === JSON.stringify(b)`：params 来自 MySQL 的 json 列，
 * 出库后键序由库里的存储决定，同一份声明换个插入顺序就会被判成漂移，
 * 结果是每次启动都刷一遍 UPDATE（连带 updated_at 乱跳，排查时非常干扰）。
 */
function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(',')}}`;
}

/** 财经资讯微服务的 REST 接口声明（seed 到 mcp_modules） */
const FINNEWS_HTTP_TOOLS: Array<{
  name: string;
  description: string;
  method: string;
  path: string;
  params: Array<{ name: string; type: string; required: boolean; description?: string }>;
}> = [
  {
    name: 'get_latest_topics',
    description: '获取最新财经话题列表，包含摘要、来源和情感倾向',
    method: 'GET',
    path: '/api/topics',
    params: [
      { name: 'limit', type: 'integer', required: false, description: '数量（默认10，最大50）' },
      { name: 'category', type: 'string', required: false, description: '分类（默认全部）' },
    ],
  },
  {
    name: 'search_news',
    description: '搜索财经资讯，支持关键词、时间范围和情感过滤',
    method: 'GET',
    path: '/api/search',
    params: [
      { name: 'query', type: 'string', required: true, description: '搜索关键词' },
      { name: 'date_range', type: 'string', required: false, description: '时间范围（今天/本周）' },
      { name: 'sentiment', type: 'string', required: false, description: '情感过滤（利好/利空/中性）' },
      { name: 'limit', type: 'integer', required: false, description: '数量' },
    ],
  },
  {
    name: 'get_stock_news',
    description: '获取某只股票的相关资讯（按关键词搜索）',
    method: 'GET',
    path: '/api/stock-news',
    params: [
      { name: 'stock_code', type: 'string', required: true, description: '股票名称或代码' },
      { name: 'limit', type: 'integer', required: false, description: '数量' },
    ],
  },
  {
    name: 'get_sector_hot',
    description: '获取某板块一周内的热门话题',
    method: 'GET',
    path: '/api/sector-hot',
    params: [
      { name: 'sector', type: 'string', required: true, description: '板块名（如半导体）' },
      { name: 'limit', type: 'integer', required: false, description: '数量' },
    ],
  },
  {
    name: 'get_sector_library',
    description: '获取板块实体库：当前数据库所有「板块」类型实体及其 7日/30日 提及热度，用于枚举可查询的板块名称（配合 get_sector_hot 使用）',
    method: 'GET',
    path: '/api/sectors',
    params: [],
  },
  {
    name: 'get_market_pulse',
    description: '获取市场情绪脉搏：情绪指数、热门板块、24小时资讯量',
    method: 'GET',
    path: '/api/market-pulse',
    params: [],
  },
];

/**
 * RAG 知识服务的 REST 接口声明（seed 到 mcp_modules，code_key=knowledge，指向 servers/knowledge-service）
 * 集合与 agent 绑定 = agent 定义 capabilities 里 config:{collectionId} 显式引用（开放决策 7 = C）；
 * 本服务只校验集合存在/启用，禁用/不存在返回明确错误。
 */
const KNOWLEDGE_HTTP_TOOLS: Array<{
  name: string;
  description: string;
  method: string;
  path: string;
  params: Array<{ name: string; type: string; required: boolean; description?: string }>;
}> = [
  {
    name: 'knowledge_search',
    description: '在指定知识集合中按语义检索知识（须先 knowledge_list 确认集合可用且已授权给当前 agent）',
    method: 'GET',
    path: '/knowledge/mcp/search',
    params: [
      { name: 'collectionId', type: 'string', required: true, description: '知识集合 id（须为当前 agent 定义 capabilities 中显式绑定的集合）' },
      { name: 'query', type: 'string', required: true, description: '检索问题/关键词' },
      { name: 'topK', type: 'integer', required: false, description: '返回条数（默认 5，最大 50）' },
    ],
  },
  {
    name: 'knowledge_list',
    description: '列出平台全部知识集合（id/名称/启用状态/文档数），便于确认要检索哪个集合',
    method: 'GET',
    path: '/knowledge/mcp/list',
    params: [],
  },
  {
    name: 'knowledge_status',
    description: '查询某文档的解析状态（parsing/ready/failed）与分块数',
    method: 'GET',
    path: '/knowledge/mcp/status/{docId}',
    params: [
      { name: 'docId', type: 'string', required: true, description: '文档 id（knowledge_ingest 返回）' },
    ],
  },
  {
    name: 'knowledge_ingest',
    description: '向指定知识集合录入一篇文档文本，同步解析分块并向量化，返回 {docId,status,chunkCount}',
    method: 'POST',
    path: '/knowledge/mcp/ingest',
    params: [
      { name: 'collectionId', type: 'string', required: true, description: '目标知识集合 id' },
      { name: 'title', type: 'string', required: true, description: '文档标题' },
      { name: 'text', type: 'string', required: true, description: '文档正文文本' },
      { name: 'source', type: 'string', required: false, description: '来源标识' },
    ],
  },
  {
    name: 'knowledge_delete',
    description: '删除文档或整个知识集合（级联删除其分块）；删除后再次检索将不再返回（R3.3）',
    method: 'POST',
    path: '/knowledge/mcp/delete',
    params: [
      { name: 'docId', type: 'string', required: false, description: '要删除的文档 id（与 collectionId 二选一）' },
      { name: 'collectionId', type: 'string', required: false, description: '要删除的集合 id（与 docId 二选一）' },
    ],
  },
];

/** 公众号发布通道的 REST 接口声明（seed 到 mcp_modules，code_key=wechat_mp） */
const WECHAT_MP_HTTP_TOOLS: Array<{
  name: string;
  description: string;
  method: string;
  path: string;
  params: Array<{ name: string; type: string; required: boolean; description?: string }>;
}> = [
  {
    name: 'create_wechat_draft',
    description:
      '发布文章到微信公众号前，先创建图文草稿（不发布）。返回 media_id，可在公众号后台确认排版后再发布',
    method: 'POST',
    path: '/api/content/wechat/draft',
    params: [
      { name: 'title', type: 'string', required: true, description: '文章标题' },
      { name: 'html', type: 'string', required: true, description: '文章正文 HTML（富文本，图片自动转微信 CDN）' },
      { name: 'thumb_media_id', type: 'string', required: false, description: '封面素材 media_id（不传则用正文首图作封面）' },
      { name: 'digest', type: 'string', required: false, description: '摘要（选填，默认取正文开头）' },
      { name: 'source_url', type: 'string', required: false, description: '原文链接（选填）' },
    ],
  },
  {
    name: 'publish_to_wechat',
    description:
      '一键发布文章到微信公众号：HTML 富文本 → 建草稿 → freepublish 提交发布。返回 publish_id 用于查询发布状态',
    method: 'POST',
    path: '/api/content/wechat/publish',
    params: [
      { name: 'title', type: 'string', required: true, description: '文章标题' },
      { name: 'html', type: 'string', required: true, description: '文章正文 HTML（富文本，图片自动转微信 CDN）' },
      { name: 'thumb_media_id', type: 'string', required: false, description: '封面素材 media_id（不传则用正文首图作封面）' },
      { name: 'digest', type: 'string', required: false, description: '摘要（选填）' },
      { name: 'source_url', type: 'string', required: false, description: '原文链接（选填）' },
      { name: 'item_id', type: 'integer', required: false, description: '关联内容条目 ID（写发布记录用，选填）' },
    ],
  },
];

/** 论文学习数据通道的 REST 接口声明（seed 到 mcp_modules，code_key=paper） */
const PAPER_HTTP_TOOLS: Array<{
  name: string;
  description: string;
  method: string;
  path: string;
  params: Array<{ name: string; type: string; required: boolean; description?: string }>;
}> = [
  {
    name: 'fetch_papers',
    description:
      '从 arXiv 拉取最新论文列表（仅查询不发布）。返回论文标题/摘要/arxiv id/链接/作者/分类，按提交时间倒序。用于论文学习、生成论文日报',
    method: 'GET',
    path: '/api/papers',
    params: [
      { name: 'categories', type: 'string', required: false, description: 'arXiv 分类（默认 cs.AI+OR+cs.CL+OR+cs.CV+OR+cs.LG）' },
      { name: 'max_results', type: 'integer', required: false, description: '返回论文数（默认 10，最大 20）' },
    ],
  },
  {
    name: 'publish_paper_digest',
    description:
      '拉取最新 arXiv 论文并渲染为公众号摘要：默认创建图文草稿（不发布，可在后台确认排版），publish=true 时直接发布。供定时任务生成「每日论文速览」。返回 media_id / publish_id',
    method: 'POST',
    path: '/api/papers/digest',
    params: [
      { name: 'categories', type: 'string', required: false, description: 'arXiv 分类（默认 cs.AI+OR+cs.CL+OR+cs.CV+OR+cs.LG）' },
      { name: 'max_results', type: 'integer', required: false, description: '论文数（默认 10，最大 20）' },
      { name: 'title', type: 'string', required: false, description: '摘要标题（默认「每日论文速览 ｜ 日期」）' },
      { name: 'publish', type: 'boolean', required: false, description: 'true=直接发布，false=仅建草稿（默认 false）' },
    ],
  },
];

/** 机构行为数据通道的 REST 接口声明（seed 到 mcp_modules，code_key=institution） */
const INSTITUTION_HTTP_TOOLS: Array<{
  name: string;
  description: string;
  method: string;
  path: string;
  params: Array<{ name: string; type: string; required: boolean; description?: string }>;
}> = [
  {
    name: 'get_quote',
    description: '实时行情快照（腾讯行情 qt.gtimg.cn 直连）：现价/涨跌幅/最高最低/换手/PE/PB/总市值/量比/均价/涨停跌停。用于机构行为「成本与估值」与实时价格维度',
    method: 'GET',
    path: '/api/institution/quote',
    params: [{ name: 'code', type: 'string', required: true, description: '股票代码，如 600519' }],
  },
  {
    name: 'get_north_holding',
    description: '北向资金个股持股（沪深港通）：最新日期北向机构数、总持股市值(万)、Top3 机构持仓。用于机构行为「静态仓位」与「北向资金」维度',
    method: 'GET',
    path: '/api/institution/north-holding',
    params: [{ name: 'code', type: 'string', required: true, description: '股票代码，如 600519' }],
  },
  {
    name: 'get_fund_flow',
    description: '主力资金流（东财 push2delay 直连，当日主力净流入 + 近 N 日 + 腾讯实时价）：每日主力净流入(元)、收盘价、涨跌幅，近5日合计与趋势。用于机构行为「动态行为」维度',
    method: 'GET',
    path: '/api/institution/fund-flow',
    params: [
      { name: 'code', type: 'string', required: true, description: '股票代码，如 600519' },
      { name: 'days', type: 'integer', required: false, description: '回溯天数（默认 10）' },
    ],
  },
  {
    name: 'get_lhb',
    description: '龙虎榜（机构席位买卖）：近期上榜日期、买卖额(万)、机构买卖说明。用于机构行为「动态行为/龙虎榜」维度',
    method: 'GET',
    path: '/api/institution/lhb',
    params: [
      { name: 'code', type: 'string', required: true, description: '股票代码，如 600519' },
      { name: 'limit', type: 'integer', required: false, description: '返回条数（默认 5）' },
    ],
  },
  {
    name: 'get_rating',
    description: '机构评级与盈利预测：评级机构数、买入/增持数、未来3年 EPS 预测。用于机构行为「研报/评级催化」维度',
    method: 'GET',
    path: '/api/institution/rating',
    params: [{ name: 'code', type: 'string', required: true, description: '股票代码，如 600519' }],
  },
  {
    name: 'get_report',
    description: '研报列表：近期研报标题、机构、日期、评级、次年 EPS/PE 预测。用于机构行为「研报催化」维度',
    method: 'GET',
    path: '/api/institution/report',
    params: [
      { name: 'code', type: 'string', required: true, description: '股票代码，如 600519' },
      { name: 'days', type: 'integer', required: false, description: '回溯天数（默认 180）' },
      { name: 'limit', type: 'integer', required: false, description: '返回条数（默认 10）' },
    ],
  },
  {
    name: 'get_valuation',
    description: '估值（腾讯行情 qt.gtimg.cn 实时）：PE_TTM/PE动/PE静、PB、总市值(亿)、流通市值(亿)、现价/涨跌幅/最高最低/换手/量比。用于机构行为「成本与估值」维度',
    method: 'GET',
    path: '/api/institution/valuation',
    params: [{ name: 'code', type: 'string', required: true, description: '股票代码，如 600519' }],
  },
  {
    name: 'get_chip',
    description: '筹码分布：东财该报表可能不可用，失败时返回 ok:false 并标注「建议人工核对成本区」。用于机构行为「成本区」维度（降级使用）',
    method: 'GET',
    path: '/api/institution/chip',
    params: [{ name: 'code', type: 'string', required: true, description: '股票代码，如 600519' }],
  },
  {
    name: 'get_finance_yoy',
    description: '业绩同比（营收/净利）：东财 F10 报表已下架，失败时返回 ok:false 并建议用 get_valuation(PE) 与 get_rating(EPS预测) 作业绩代理。用于机构行为「5分钟排雷」维度（降级使用）',
    method: 'GET',
    path: '/api/institution/finance-yoy',
    params: [{ name: 'code', type: 'string', required: true, description: '股票代码，如 600519' }],
  },
];

/** 发布模块「同步工具」声明（seed 到 mcp_modules/mcp_tools，code_key=deploy） */
const DEPLOY_HTTP_TOOLS: Array<{
  name: string;
  description: string;
  method: string;
  path: string;
  params: Array<{ name: string; type: string; required: boolean; description?: string }>;
}> = [
  {
    name: 'list_modules',
    description: '列出可发布模块（key/名称/类型/目录）。发布前用它确认模块标识，不要凭空猜测',
    method: 'GET',
    path: '/api/mcp/modules',
    params: [],
  },
  {
    name: 'get_current_versions',
    description: '查询指定环境各模块的当前线上版本（含发布时间与发布人）',
    method: 'GET',
    path: '/api/mcp/current-versions',
    params: [{ name: 'env', type: 'string', required: true, description: '环境 local（本机，不污染 dev）/dev/staging/prod' }],
  },
  {
    name: 'list_releases',
    description: '列出版本发布历史（回滚候选版本），按发布时间倒序',
    method: 'GET',
    path: '/api/mcp/releases',
    params: [
      { name: 'env', type: 'string', required: false, description: '环境 local/dev/staging/prod' },
      { name: 'component', type: 'string', required: false, description: '模块 key，如 admin' },
    ],
  },
  {
    name: 'release_plan',
    description:
      '发布提案（**只读 dry-run，不改动任何东西**）：返回这次发布的影响面、7 项前置检查结论、' +
      '风险等级（low/medium/high/critical）与是否需要人工审批。发布前先调它确认能不能发 —— ' +
      'blockers 非空表示提交会被直接拒绝；warnings 列出有告警或**判定不了**的项；' +
      'knownGaps 列出本工具尚未覆盖的检查，**没有报警不等于检查过**。' +
      '返回的 planId 是幂等提案标识（同入参恒相同），evidenceHash 是当时的事实指纹（事实漂移后会变）',
    method: 'POST',
    path: '/api/mcp/release-plan',
    params: [
      { name: 'env', type: 'string', required: true, description: '目标环境 local/dev/staging/prod' },
      { name: 'moduleKey', type: 'string', required: true, description: '模块 key（不确定先用 list_modules 查，不要猜）' },
      {
        name: 'versionTag',
        type: 'string',
        required: false,
        description: '目标版本（纯 git 短哈希，或 namespace/commit 形式的完整引用）。不传 = 现场构建，此时产物是否存在无法预判',
      },
      { name: 'mode', type: 'string', required: false, description: 'direct（默认，全量直发）/ grayscale（灰度，须同时传 grayscaleRule）' },
      {
        name: 'grayscaleRule',
        type: 'string',
        required: false,
        description:
          '灰度规则，**字符串**（本工具只做 dry-run，它仅参与影响面判定与输入指纹）。' +
          '真正提交发布时 publish_pipeline 的 grayscaleRule 是**对象**（如 {type:"percent",value:10}），两处类型刻意不同',
      },
    ],
  },
  {
    name: 'verify_release',
    description:
      '**发布后验证（只读，不改动任何东西）**：比对**此刻的线上事实**，回答「这次发布真的生效了吗」。' +
      '⚠️ 判据不是流水线状态 —— `status=succeeded` 只说明脚本跑完，不说明产物落地、进程重启。' +
      '检查项：流水线是否成功 / 线上版本指针是否等于目标版本 / 目标版本目录是否有入口产物 / ' +
      '服务进程是否在线 / 端口是否监听。' +
      '返回 verified（已生效）/ failed（未生效）/ unknown（判不了，缺真相源或采集故障）/ ' +
      'degraded（生效但有瑕疵）。' +
      '⚠️ **unknown 不等于通过**：核心项判不了时整体就是 unknown，绝不当成通过。' +
      'warnings 含所有 unknown 与 skipped 及其原因；knownGaps 列出尚未覆盖的检查；' +
      '**没有报警不等于检查过**。strict=true 时非核心项失败也判 failed',
    method: 'POST',
    path: '/api/mcp/release-verify',
    params: [
      { name: 'env', type: 'string', required: true, description: '目标环境 local/dev/staging/prod' },
      { name: 'moduleKey', type: 'string', required: true, description: '模块 key（不确定先用 list_modules 查，不要猜）' },
      {
        name: 'versionTag',
        type: 'string',
        required: false,
        description:
          '期望生效的目标版本。**不传则回落为当前线上指针** —— 那是"确认现状"而非"验证发布"，' +
          '此时 expected.source=current-pointer，结论恒为通过，**不能用作发布生效的证据**',
      },
      {
        name: 'jobId',
        type: 'string',
        required: false,
        description: '关联流水线 jobId。传了才会校验「流水线是否成功」这项；不传则只做事实比对',
      },
      {
        name: 'strict',
        type: 'boolean',
        required: false,
        description: '严格模式：非核心项（进程/端口）失败也判 failed。默认 false（降级为 degraded）',
      },
    ],
  },
  {
    name: 'publish_version',
    description: '把某模块的线上指针切到指定历史版本（秒级生效，不重新构建）。用于回滚或版本回退',
    method: 'POST',
    path: '/api/mcp/version',
    params: [
      { name: 'env', type: 'string', required: true, description: '环境 local（本机，不污染 dev）/dev/staging/prod' },
      { name: 'versionTag', type: 'string', required: true, description: '目标版本标签（git 短哈希）' },
      { name: 'confirm', type: 'boolean', required: false, description: 'prod 环境必须传 true' },
      {
        name: 'component',
        type: 'string',
        required: false,
        description:
          '模块 key。**仅回退路径需要**：版本表里查不到该版本时（历史 deploy.sh 写入的记录形如 mf:admin），' +
          '传 component 可在产物确实存在时直接切指针。正常情况不需要传',
      },
    ],
  },
  {
    name: 'rollback',
    description: '回滚到指定版本（走脚本级回滚任务，返回 taskId）。前端模块优先用 publish_version（秒级切换）',
    method: 'POST',
    path: '/api/mcp/rollback',
    params: [
      { name: 'env', type: 'string', required: true, description: '环境 local（本机，不污染 dev）/dev/staging/prod' },
      { name: 'versionTag', type: 'string', required: true, description: '目标版本标签' },
      { name: 'component', type: 'string', required: false, description: '模块 key（可选，便于定位）' },
      { name: 'confirm', type: 'boolean', required: false, description: 'prod 环境必须传 true' },
    ],
  },
  {
    name: 'promote_release',
    description: '灰度转全量：把 stable 指针切到灰度版本并禁用灰度规则。入参为灰度流水线的 jobId',
    method: 'POST',
    path: '/api/mcp/pipeline/{pipelineId}/promote',
    params: [
      { name: 'pipelineId', type: 'string', required: true, description: '灰度流水线的 jobId' },
    ],
  },
  {
    name: 'approve_pipeline',
    description:
      '审批**通过**挂起中的流水线（挂起时 status=awaiting-approval）。' +
      '只有流水线的**提交者本人**能审批自己的流水线，prod 环境必须额外传 confirm=true。' +
      '审批人由调用所用 API Key 解析，审计可追溯到人。' +
      '先调 publish_pipeline 拿到 jobId，流水线若配置了审批门禁会在此挂起',
    method: 'POST',
    path: '/api/mcp/pipeline/{jobId}/approve',
    params: [
      { name: 'jobId', type: 'string', required: true, description: '流水线 jobId（publish_pipeline 返回）' },
      { name: 'confirm', type: 'boolean', required: false, description: 'prod 环境审批必须传 true（审批是最终放行点，比提交更需要显式确认）' },
      { name: 'comment', type: 'string', required: false, description: '审批意见（可空，建议写清放行理由）' },
      { name: 'nodeKey', type: 'string', required: false, description: '多审批节点时指定节点；不传则审批当前待决节点' },
    ],
  },
  {
    name: 'reject_pipeline',
    description:
      '审批**拒绝**挂起中的流水线，流水线转入终态不再继续。**审批意见必填**（拒绝不留理由等于无法复盘）。' +
      '同样只允许提交者本人操作',
    method: 'POST',
    path: '/api/mcp/pipeline/{jobId}/reject',
    params: [
      { name: 'jobId', type: 'string', required: true, description: '流水线 jobId' },
      { name: 'comment', type: 'string', required: true, description: '拒绝理由（**必填**，空字符串会被拒绝）' },
      { name: 'nodeKey', type: 'string', required: false, description: '多审批节点时指定节点' },
    ],
  },
];

/** 发布模块「任务型工具」声明（代码内置，不进 mcp_tools 表） */
const DEPLOY_JOB_TOOLS: HttpJobToolDef[] = [
  {
    name: 'publish_pipeline',
    description:
      '提交发布流水线：构建 → 投递产物 → 写版本表 → 切指针 → 等缓存并验证 → 清理旧版本。' +
      '默认异步返回 jobId；传入 waitTimeoutSec（秒）可同步等待到终态。' +
      '支持按「环境 + 模块 + 版本」发布；mode=grayscale 时为灰度发布（不切全量指针）',
    longRunning: true,
    waitTimeoutSec: 0,
    submit: {
      method: 'POST',
      path: '/api/mcp/pipeline',
      params: [
        { name: 'env', type: 'string', required: true, description: '环境 local（本机，不污染 dev）/dev/staging/prod' },
        { name: 'moduleKey', type: 'string', required: true, description: '模块 key，如 admin / portal / todo-service' },
        {
          name: 'branch',
          type: 'string',
          required: false,
          description:
            '目标分支（默认 master）。发布在隔离的发布目录从远程仓库拉取该分支代码，' +
            '不会基于当前工作区；先 push 到仓库再发布才能拿到最新代码',
        },
        {
          name: 'commitId',
          type: 'string',
          required: false,
          description:
            '目标 commit（git 短哈希，默认取该分支最新）。' +
            '已有该版本产物时复用秒级发布；否则在发布目录拉取该 commit 后构建',
        },
        {
          name: 'mode',
          type: 'string',
          required: false,
          description: 'direct=全量发布（默认）；grayscale=灰度发布（需配合 grayscaleRule）',
        },
        {
          name: 'versionTag',
          type: 'string',
          required: false,
          description: '已废弃，等价于 commitId（兼容旧调用）',
        },
        {
          name: 'target',
          type: 'string',
          required: false,
          description: '投递目标 local=本机静态目录（默认）；remote=SSH 到远程服务器',
        },
        {
          name: 'grayscaleRule',
          type: 'object',
          required: false,
          description:
            '灰度规则（mode=grayscale 必填）：{type:"percent",value:10} 或 {type:"user-list",userIds:["u1"]} 或 {type:"header",key:"x-canary",values:["on"]}',
        },
        { name: 'confirm', type: 'boolean', required: false, description: 'prod 环境发布必须传 true' },
      ],
    },
    status: { method: 'GET', path: '/api/mcp/pipeline/{jobId}' },
    cancel: { method: 'POST', path: '/api/mcp/pipeline/{jobId}/cancel' },
    poll: { intervalMs: 3000 },
  },
];

/** dev-only：模拟长任务，用于验证 T3 双模式，不触发真实构建 */
const MOCK_JOB_TOOLS: HttpJobToolDef[] = [
  {
    name: 'mock_job',
    description: '[仅非生产环境] 提交一个模拟长任务，用于验证长任务的异步/同步等待两种模式',
    longRunning: true,
    waitTimeoutSec: 0,
    submit: {
      method: 'POST',
      path: '/api/mcp/mock-job',
      params: [
        { name: 'seconds', type: 'integer', required: false, description: '任务耗时秒数（1-600，默认 5）' },
      ],
    },
    status: { method: 'GET', path: '/api/mcp/mock-job/{jobId}' },
  },
];

@Injectable()
export class McpService implements OnModuleInit {
  private readonly logger = new Logger(McpService.name);
  private readonly transports = new Map<string, StreamableHTTPServerTransport>();

  constructor(
    @InjectRepository(McpModuleEntity)
    private readonly moduleRepo: Repository<McpModuleEntity>,
    @InjectRepository(McpToolEntity)
    private readonly toolRepo: Repository<McpToolEntity>,
    @InjectRepository(McpJobEntity)
    private readonly jobRepo: Repository<McpJobEntity>,
  ) {}

  /** 启动时 seed 各 HTTP 模块（自动注册后台微服务 REST 接口） */
  async onModuleInit(): Promise<void> {
    await this.seedFinnewsHttpModule();
    await this.seedWechatMpModule();
    await this.seedPaperModule();
    await this.seedInstitutionModule();
    await this.seedDeployModule();
    await this.seedKnowledgeModule();
  }

  /** 某模块的代码内置任务型工具（job 声明不进 mcp_tools 表，结构不同） */
  private jobToolsFor(codeKey: string): HttpJobToolDef[] {
    if (codeKey !== 'deploy') return [];
    const isProd = process.env.NODE_ENV === 'production';
    return isProd ? DEPLOY_JOB_TOOLS : [...DEPLOY_JOB_TOOLS, ...MOCK_JOB_TOOLS];
  }

  /**
   * 记录 jobId → 模块映射（通用 get_job_status 依赖）。
   * @param operatorHint 调用者提示（API Key 前缀）；**禁止存完整凭证**，审计主数据在后端 audit_logs
   */
  private async recordJob(
    jobId: string,
    toolName: string,
    codeKey: string,
    operatorHint?: string,
  ): Promise<void> {
    try {
      await this.jobRepo.upsert(
        { job_id: jobId, code_key: codeKey, tool_name: toolName, operator: operatorHint ?? null },
        ['job_id'],
      );
    } catch (e) {
      this.logger.warn(`记录任务索引失败(${jobId}): ${(e as Error).message}`);
    }
  }

  /**
   * jobId → 模块路由。
   * 优先查 mcp_jobs 索引表；未命中时按 jobId 前缀兜底（mock- → mock_job）。
   */
  private async resolveJobRoute(jobId: string): Promise<{ codeKey?: string; toolName?: string } | undefined> {
    try {
      const row = await this.jobRepo.findOne({ where: { job_id: jobId } });
      if (row) return { codeKey: row.code_key, toolName: row.tool_name };
    } catch (e) {
      this.logger.warn(`查询任务索引失败(${jobId}): ${(e as Error).message}`);
    }
    if (jobId.startsWith('mock-')) return { codeKey: 'deploy', toolName: 'mock_job' };
    return undefined;
  }

  /** seed 论文学习模块（code_key=paper，直连本机 content-hub 的 /api/papers 接口） */
  private async seedPaperModule(): Promise<void> {
    // paper 数据源在 content-hub，与 finnews 同机部署；优先直连本机，避免跨机
    const baseUrl = process.env.CONTENT_HUB_SERVICE_URL ?? 'http://127.0.0.1:6007';
    const authType = '';
    const authConfig: Record<string, any> | null = null;

    let existing = await this.moduleRepo.findOne({ where: { code_key: 'paper' } });
    if (existing && existing.module_type !== 'http') {
      await this.moduleRepo.delete({ id: existing.id });
      existing = null;
    }
    if (existing) {
      let changed = false;
      if (existing.base_url !== baseUrl) {
        existing.base_url = baseUrl;
        changed = true;
      }
      if (existing.auth_type !== authType) {
        existing.auth_type = authType;
        changed = true;
      }
      if (JSON.stringify(existing.auth_config ?? null) !== JSON.stringify(authConfig)) {
        existing.auth_config = authConfig;
        changed = true;
      }
      if (changed) {
        await this.moduleRepo.update(existing.id, {
          base_url: baseUrl,
          auth_type: authType,
          auth_config: authConfig,
        });
        this.logger.log(`已同步论文学习 base_url=${baseUrl} auth_type=${authType || '(无)'}`);
      }
      await this.syncModuleTools(existing.id, PAPER_HTTP_TOOLS);
      return;
    }

    const mod = await this.moduleRepo.save(
      this.moduleRepo.create({
        name: '论文学习',
        description: '论文学习微服务：arXiv 最新论文拉取（cs.AI/CL/CV/LG），按提交时间倒序',
        base_url: baseUrl,
        timeout: 30,
        auth_type: authType,
        auth_config: authConfig,
        module_type: 'http',
        code_key: 'paper',
        enabled: true,
      }),
    );
    const tools = PAPER_HTTP_TOOLS.map((t) =>
      this.toolRepo.create({ module_id: mod.id, ...t }),
    );
    await this.toolRepo.save(tools);
    this.logger.log(`已 seed 论文学习 HTTP 模块: ${baseUrl}（${tools.length} 个工具）`);
  }

  /** seed 机构行为数据模块（code_key=institution，直连本机 content-hub 的 /api/institution/* 接口） */
  private async seedInstitutionModule(): Promise<void> {
    // institution 数据源在 content-hub，与 finnews 同机部署；优先直连本机
    const baseUrl = process.env.INSTITUTION_SERVICE_URL ?? 'http://127.0.0.1:6007';
    const authType = '';
    const authConfig: Record<string, any> | null = null;

    let existing = await this.moduleRepo.findOne({ where: { code_key: 'institution' } });
    if (existing && existing.module_type !== 'http') {
      await this.moduleRepo.delete({ id: existing.id });
      existing = null;
    }
    if (existing) {
      let changed = false;
      if (existing.base_url !== baseUrl) {
        existing.base_url = baseUrl;
        changed = true;
      }
      if (existing.auth_type !== authType) {
        existing.auth_type = authType;
        changed = true;
      }
      if (JSON.stringify(existing.auth_config ?? null) !== JSON.stringify(authConfig)) {
        existing.auth_config = authConfig;
        changed = true;
      }
      if (changed) {
        await this.moduleRepo.update(existing.id, {
          base_url: baseUrl,
          auth_type: authType,
          auth_config: authConfig,
        });
        this.logger.log(`已同步机构行为 base_url=${baseUrl} auth_type=${authType || '(无)'}`);
      }
      await this.syncModuleTools(existing.id, INSTITUTION_HTTP_TOOLS);
      return;
    }

    const mod = await this.moduleRepo.save(
      this.moduleRepo.create({
        name: '机构行为数据',
        description: '机构行为全周期追踪框架数据源：北向持股/主力资金流/龙虎榜/机构评级/研报/估值/筹码/业绩同比（东方财富公开接口）',
        base_url: baseUrl,
        timeout: 30,
        auth_type: authType,
        auth_config: authConfig,
        module_type: 'http',
        code_key: 'institution',
        enabled: true,
      }),
    );
    const tools = INSTITUTION_HTTP_TOOLS.map((t) =>
      this.toolRepo.create({ module_id: mod.id, ...t }),
    );
    await this.toolRepo.save(tools);
    this.logger.log(`已 seed 机构行为 HTTP 模块: ${baseUrl}（${tools.length} 个工具）`);
  }

  private async seedFinnewsHttpModule(): Promise<void> {
    // 统一默认地址为 127.0.0.1（与 paper/institution 一致），避免 localhost 解析不稳定
    const baseUrl = process.env.FINNEWS_SERVICE_URL ?? 'http://127.0.0.1:6007';
    const authType = process.env.FINNEWS_SERVICE_AUTH_TYPE ?? '';
    const authConfigRaw = process.env.FINNEWS_SERVICE_AUTH_CONFIG ?? '';
    let authConfig: Record<string, any> | null = null;
    if (authConfigRaw) {
      try {
        authConfig = JSON.parse(authConfigRaw);
      } catch (e) {
        this.logger.warn(`FINNEWS_SERVICE_AUTH_CONFIG JSON 解析失败: ${authConfigRaw}`);
      }
    }

    let existing = await this.moduleRepo.findOne({ where: { code_key: 'finnews' } });
    // 旧 code 类型记录 → 迁移为 http（删除重建）
    if (existing && existing.module_type !== 'http') {
      await this.moduleRepo.delete({ id: existing.id });
      existing = null;
    }
    if (existing) {
      // 已存在：同步 base_url / auth_type / auth_config（环境变量可能变更）
      let changed = false;
      if (existing.base_url !== baseUrl) {
        existing.base_url = baseUrl;
        changed = true;
      }
      if (existing.auth_type !== authType) {
        existing.auth_type = authType;
        changed = true;
      }
      if (JSON.stringify(existing.auth_config ?? null) !== JSON.stringify(authConfig)) {
        existing.auth_config = authConfig;
        changed = true;
      }
      if (changed) {
        // 用 update 而非 save(entity)：save 会级联 eager 加载的 tools 触发 module_id 置空报错
        await this.moduleRepo.update(existing.id, {
          base_url: baseUrl,
          auth_type: authType,
          auth_config: authConfig,
        });
        this.logger.log(
          `已同步财经资讯 base_url=${baseUrl} auth_type=${authType || '(无)'}`,
        );
      }
      await this.syncModuleTools(existing.id, FINNEWS_HTTP_TOOLS);
      return;
    }

    const mod = await this.moduleRepo.save(
      this.moduleRepo.create({
        name: '财经资讯',
        description: '财经资讯微服务：采集新浪/东财快讯，SimHash 去重 + LLM 摘要/情感分析',
        base_url: baseUrl,
        timeout: 30,
        auth_type: authType,
        auth_config: authConfig,
        module_type: 'http',
        code_key: 'finnews',
        enabled: true,
      }),
    );
    const tools = FINNEWS_HTTP_TOOLS.map((t) =>
      this.toolRepo.create({ module_id: mod.id, ...t }),
    );
    await this.toolRepo.save(tools);
    this.logger.log(`已 seed 财经资讯 HTTP 模块: ${baseUrl}（${tools.length} 个工具）`);
  }

  /** seed RAG 知识模块（code_key=knowledge，指向 knowledge-service；Bearer token 与 knowledge-service INTERNAL_API_KEY 同值） */
  private async seedKnowledgeModule(): Promise<void> {
    const baseUrl = process.env.KNOWLEDGE_SERVICE_URL ?? 'http://localhost:6011';
    const authType = process.env.KNOWLEDGE_SERVICE_AUTH_TYPE ?? 'bearer';
    const authConfigRaw = process.env.KNOWLEDGE_SERVICE_AUTH_CONFIG ?? '';
    let authConfig: Record<string, any> | null = null;
    if (authConfigRaw) {
      try {
        authConfig = JSON.parse(authConfigRaw);
      } catch (e) {
        this.logger.warn(`KNOWLEDGE_SERVICE_AUTH_CONFIG JSON 解析失败: ${authConfigRaw}`);
      }
    }

    let existing = await this.moduleRepo.findOne({ where: { code_key: 'knowledge' } });
    if (existing && existing.module_type !== 'http') {
      await this.moduleRepo.delete({ id: existing.id });
      existing = null;
    }
    if (existing) {
      let changed = false;
      if (existing.base_url !== baseUrl) {
        existing.base_url = baseUrl;
        changed = true;
      }
      if (existing.auth_type !== authType) {
        existing.auth_type = authType;
        changed = true;
      }
      if (JSON.stringify(existing.auth_config ?? null) !== JSON.stringify(authConfig)) {
        existing.auth_config = authConfig;
        changed = true;
      }
      if (changed) {
        await this.moduleRepo.update(existing.id, {
          base_url: baseUrl,
          auth_type: authType,
          auth_config: authConfig,
        });
        this.logger.log(
          `已同步 RAG 知识模块 base_url=${baseUrl} auth_type=${authType || '(无)'}`,
        );
      }
      await this.syncModuleTools(existing.id, KNOWLEDGE_HTTP_TOOLS);
      return;
    }

    const mod = await this.moduleRepo.save(
      this.moduleRepo.create({
        name: 'RAG 知识服务',
        description: '知识集合检索/录入/管理：语义检索、文档向量化入库（servers/knowledge-service）',
        base_url: baseUrl,
        timeout: 60,
        auth_type: authType,
        auth_config: authConfig,
        module_type: 'http',
        code_key: 'knowledge',
        enabled: true,
      }),
    );
    const tools = KNOWLEDGE_HTTP_TOOLS.map((t) =>
      this.toolRepo.create({ module_id: mod.id, ...t }),
    );
    await this.toolRepo.save(tools);
    this.logger.log(`已 seed RAG 知识 HTTP 模块: ${baseUrl}（${tools.length} 个工具）`);
  }

  /** seed 公众号发布模块（code_key=wechat_mp，指向 content-hub 的公众号发布接口） */
  private async seedWechatMpModule(): Promise<void> {
    // 统一默认地址为 127.0.0.1（与 paper/institution 一致），避免 localhost 解析不稳定
    const baseUrl = process.env.CONTENT_HUB_SERVICE_URL ?? 'http://127.0.0.1:6007';
    const authType = process.env.CONTENT_HUB_SERVICE_AUTH_TYPE ?? '';
    const authConfigRaw = process.env.CONTENT_HUB_SERVICE_AUTH_CONFIG ?? '';
    let authConfig: Record<string, any> | null = null;
    if (authConfigRaw) {
      try {
        authConfig = JSON.parse(authConfigRaw);
      } catch (e) {
        this.logger.warn(`CONTENT_HUB_SERVICE_AUTH_CONFIG JSON 解析失败: ${authConfigRaw}`);
      }
    }

    let existing = await this.moduleRepo.findOne({ where: { code_key: 'wechat_mp' } });
    if (existing && existing.module_type !== 'http') {
      await this.moduleRepo.delete({ id: existing.id });
      existing = null;
    }
    if (existing) {
      let changed = false;
      if (existing.base_url !== baseUrl) {
        existing.base_url = baseUrl;
        changed = true;
      }
      if (existing.auth_type !== authType) {
        existing.auth_type = authType;
        changed = true;
      }
      if (JSON.stringify(existing.auth_config ?? null) !== JSON.stringify(authConfig)) {
        existing.auth_config = authConfig;
        changed = true;
      }
      if (changed) {
        await this.moduleRepo.update(existing.id, {
          base_url: baseUrl,
          auth_type: authType,
          auth_config: authConfig,
        });
        this.logger.log(`已同步公众号发布 base_url=${baseUrl} auth_type=${authType || '(无)'}`);
      }
      await this.syncModuleTools(existing.id, WECHAT_MP_HTTP_TOOLS);
      return;
    }

    const mod = await this.moduleRepo.save(
      this.moduleRepo.create({
        name: '公众号发布',
        description: '微信公众号内容发布：创建图文草稿 / 一键发布（HTML 富文本，正文图片自动转微信 CDN）',
        base_url: baseUrl,
        timeout: 120,
        auth_type: authType,
        auth_config: authConfig,
        module_type: 'http',
        code_key: 'wechat_mp',
        enabled: true,
      }),
    );
    const tools = WECHAT_MP_HTTP_TOOLS.map((t) =>
      this.toolRepo.create({ module_id: mod.id, ...t }),
    );
    await this.toolRepo.save(tools);
    this.logger.log(`已 seed 公众号发布 HTTP 模块: ${baseUrl}（${tools.length} 个工具）`);
  }

  /**
   * 工具差量同步：让库里的工具定义与代码声明一致 —— **缺失则插入，有差异则更新**。
   *
   * 历史包袱：早期只做"补插缺失"，理由是"seed 只在模块不存在时创建，升级后新工具不生效"。
   * 但只补插意味着**已有工具的 params 改了永远不会落库** —— 代码声明改了、库里还是旧的，
   * `tools/list` 下发给 Agent 的 inputSchema 也就还是旧的。
   * 表现是"我明明补了参数声明，Agent 却说没有这个参数"，而且只在**已部署过**的环境出现，
   * 新环境一切正常 —— 排查时极易误判成缓存或 SDK 问题。
   *
   * 只补 description / method / path / params 四个声明字段，不动 id / module_id / created_at。
   */
  private async syncModuleTools(
    moduleId: number,
    declared: Array<{
      name: string;
      description: string;
      method: string;
      path: string;
      params: Array<Record<string, unknown>>;
    }>,
  ): Promise<void> {
    const existing = await this.toolRepo.find({ where: { module_id: moduleId } });
    const existingByName = new Map(existing.map((t) => [t.name, t]));

    const missing = declared.filter((t) => !existingByName.has(t.name));
    if (missing.length > 0) {
      await this.toolRepo.save(
        missing.map((t) => this.toolRepo.create({ module_id: moduleId, ...t })),
      );
      this.logger.log(`模块 #${moduleId} 补插缺失工具: ${missing.map((t) => t.name).join(', ')}`);
    }

    // 定义漂移：同名的比对声明字段，不同才写（避免每次启动无谓 UPDATE 刷 updated_at）
    const drifted = declared.filter((t) => {
      const row = existingByName.get(t.name);
      if (!row) return false;
      return (
        row.description !== t.description ||
        row.method !== t.method ||
        row.path !== t.path ||
        stableJson(row.params) !== stableJson(t.params)
      );
    });
    if (drifted.length === 0) return;
    for (const t of drifted) {
      await this.toolRepo.update(
        { module_id: moduleId, name: t.name },
        { description: t.description, method: t.method, path: t.path, params: t.params },
      );
    }
    this.logger.log(`模块 #${moduleId} 更新已变更工具: ${drifted.map((t) => t.name).join(', ')}`);
  }

  /**
   * 从数据库构建 MCP Server（每个 session 独立实例，规避 SDK 单 transport 限制）。
   * @param token 当前调用者凭证，透传给下游（auth_type=pass-through 的模块）
   */
  private async buildServerFromDb(moduleCode?: string, token?: string): Promise<McpServer> {
    const where: any = { enabled: true };
    if (moduleCode) where.code_key = moduleCode;
    const modules = await this.moduleRepo.find({ where });
    if (moduleCode && modules.length === 0) {
      throw new NotFoundException(`模块 ${moduleCode} 不存在或未启用`);
    }

    const configs: Array<{ codeKey: string; config: HttpModuleConfig }> = [];
    const mcpModules = modules.map((m) => {
      const config = this.toConfig(m, token);
      if (m.code_key) configs.push({ codeKey: m.code_key, config });
      return createHttpModule(m.name, config);
    });

    // 通用任务工具：get_job_status / cancel_job（跨模块，按 jobId 路由）
    mcpModules.push(
      createJobStatusModule({
        modules: configs,
        resolveModule: (jobId: string) => this.resolveJobRoute(jobId),
      }),
    );

    return buildServer(
      { name: 'mcp-gateway', version: '1.0.0', instructions: '统一 MCP 网关' },
      mcpModules,
    );
  }

  private toConfig(m: McpModuleEntity, token?: string): HttpModuleConfig {
    const codeKey = m.code_key ?? undefined;
    return {
      base_url: m.base_url,
      timeout: m.timeout,
      auth: { type: m.auth_type, ...(m.auth_config ?? {}) },
      codeKey,
      /** 凭证透传：把调用者的 API Key 原样带给下游，由下游换取 ownerId 落审计 */
      credentialProvider: () => token,
      onJobSubmitted: (job) => {
        // 只存 key 前缀，避免把调用者凭证明文落库
        void this.recordJob(job.jobId, job.toolName, job.codeKey ?? '', token?.slice(0, 12));
      },
      jobs: codeKey ? this.jobToolsFor(codeKey) : undefined,
      tools: (m.tools ?? []).map(
        (t) =>
          ({
            name: t.name,
            description: t.description,
            method: t.method as HttpToolDef['method'],
            path: t.path,
            params: t.params ?? [],
          }) as HttpToolDef,
      ),
    };
  }

  // ── 会话管理 ──

  getTransport(sessionId: string): StreamableHTTPServerTransport | undefined {
    return this.transports.get(sessionId);
  }

  /** @param token 调用者凭证，绑定到本次会话的 server 实例，供下游透传 */
  async createTransport(token?: string): Promise<StreamableHTTPServerTransport> {
    return this.buildAndConnect(undefined, token);
  }

  /** 按模块 code_key 创建 transport（只暴露该模块工具），如 /mcp/finnews → finnews 的工具 */
  async createModuleTransport(moduleCode: string, token?: string): Promise<StreamableHTTPServerTransport> {
    return this.buildAndConnect(moduleCode, token);
  }

  private async buildAndConnect(
    moduleCode?: string,
    token?: string,
  ): Promise<StreamableHTTPServerTransport> {
    const server = await this.buildServerFromDb(moduleCode, token);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        this.transports.set(sid, transport);
      },
    });
    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) this.transports.delete(sid);
    };
    await server.connect(transport);
    return transport;
  }

  removeTransport(sessionId: string): void {
    this.transports.delete(sessionId);
  }

  /**
   * 直接调用模块下的某个工具（供 ai-agent 等内部调用方经 /mcp/tools/call 使用）。
   * 走与 MCP streamable-http 相同的 HttpModuleConfig + callApi 链路，无状态。
   */
  async callTool(
    moduleCode: string,
    toolName: string,
    args: Record<string, unknown>,
    token?: string,
  ): Promise<unknown> {
    const mod = await this.moduleRepo.findOne({
      where: { code_key: moduleCode, enabled: true },
      relations: ['tools'],
    });
    if (!mod) throw new NotFoundException(`模块 ${moduleCode} 不存在或未启用`);
    const config = this.toConfig(mod, token);

    // 通用任务工具（跨模块）：按 jobId 路由到归属模块
    if (toolName === 'get_job_status' || toolName === 'cancel_job') {
      return this.handleJobQuery(toolName, args ?? {}, token);
    }

    // 任务型工具：与 MCP 工具保持同一套 T3 语义（提交 / 可选同步等待）
    const jobDef = (config.jobs ?? []).find((j) => j.name === toolName);
    if (jobDef) {
      const result = await executeJob(config, jobDef, args ?? {});
      return { content: result.content[0]?.text ?? '', isError: result.isError ?? false };
    }

    const toolDef = (mod.tools ?? []).find((t) => t.name === toolName);
    if (!toolDef) throw new NotFoundException(`工具 ${toolName} 在模块 ${moduleCode} 中不存在`);

    const def: HttpToolDef = {
      name: toolDef.name,
      description: toolDef.description,
      method: toolDef.method as HttpToolDef['method'],
      path: toolDef.path,
      params: toolDef.params ?? [],
    };
    // 与任务型工具保持一致的返回结构：统一包装为 { content: "<json>" }
    const result = await callApi(config, def, args ?? {}, { passThroughToken: token });
    return { content: typeof result === 'string' ? result : JSON.stringify(result) };
  }

  /**
   * 通用任务查询/取消（/mcp/tools/call 直调入口，与 MCP 工具 get_job_status / cancel_job 等价）。
   * 按 jobId 找到归属模块，再走该模块任务工具的 status / cancel 接口。
   */
  private async handleJobQuery(
    toolName: 'get_job_status' | 'cancel_job',
    args: Record<string, unknown>,
    token?: string,
  ): Promise<unknown> {
    const jobId = String(args?.jobId ?? '');
    if (!jobId) throw new BadRequestException('缺少 jobId');
    const route = await this.resolveJobRoute(jobId);
    if (!route?.codeKey) throw new NotFoundException(`未知任务: ${jobId}`);

    const mod = await this.moduleRepo.findOne({
      where: { code_key: route.codeKey, enabled: true },
    });
    if (!mod) throw new NotFoundException(`模块 ${route.codeKey} 不存在或未启用`);

    const config = this.toConfig(mod, token);
    const jobs = config.jobs ?? [];
    const jobDef =
      (route.toolName ? jobs.find((j) => j.name === route.toolName) : undefined) ?? jobs[0];
    if (!jobDef) throw new NotFoundException(`模块 ${route.codeKey} 未声明任务型工具`);

    if (toolName === 'get_job_status') {
      const st = await callApi(
        config,
        { method: jobDef.status.method, path: jobDef.status.path },
        { jobId },
        { passThroughToken: token },
      );
      return { content: JSON.stringify(st) };
    }

    if (!jobDef.cancel) {
      throw new BadRequestException(`任务工具 ${jobDef.name} 不支持取消`);
    }
    const res = await callApi(config, jobDef.cancel, { jobId }, { passThroughToken: token });
    return { content: JSON.stringify(res) };
  }

  /** seed 发布管理模块（code_key=deploy，指向 deploy-console 的 /api/mcp/* 接口） */
  private async seedDeployModule(): Promise<void> {
    const baseUrl = process.env.DEPLOY_CONSOLE_URL ?? 'http://127.0.0.1:6200';
    const authType = 'pass-through';
    const authConfig: Record<string, any> | null = null;
    const timeout = 60;

    let existing = await this.moduleRepo.findOne({ where: { code_key: 'deploy' } });
    if (existing && existing.module_type !== 'http') {
      await this.moduleRepo.delete({ id: existing.id });
      existing = null;
    }
    if (existing) {
      if (
        existing.base_url !== baseUrl ||
        existing.auth_type !== authType ||
        existing.timeout !== timeout
      ) {
        await this.moduleRepo.update(existing.id, {
          base_url: baseUrl,
          auth_type: authType,
          auth_config: authConfig,
          timeout,
        });
        this.logger.log(`已同步发布管理 base_url=${baseUrl} auth_type=${authType}`);
      }
      await this.syncModuleTools(existing.id, DEPLOY_HTTP_TOOLS);
      return;
    }

    const mod = await this.moduleRepo.save(
      this.moduleRepo.create({
        name: '发布管理',
        description:
          '发布流水线：按「环境 + 模块 + 版本」发布微前端模块（admin/portal），支持灰度发布、转全量、回滚与版本历史查询',
        base_url: baseUrl,
        timeout,
        auth_type: authType,
        auth_config: authConfig,
        module_type: 'http',
        code_key: 'deploy',
        enabled: true,
      }),
    );
    const tools = DEPLOY_HTTP_TOOLS.map((t) => this.toolRepo.create({ module_id: mod.id, ...t }));
    await this.toolRepo.save(tools);
    this.logger.log(
      `已 seed 发布管理 HTTP 模块: ${baseUrl}（${tools.length} 个同步工具 + ${this.jobToolsFor('deploy').length} 个任务型工具）`,
    );
  }
}
