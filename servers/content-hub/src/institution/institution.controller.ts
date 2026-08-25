import { Controller, Get, Query } from '@nestjs/common';
import { InstitutionService } from './institution.service';

/** 机构行为数据 REST API（供 mcp-gateway / kedou-mcp-curl 调用） */
@Controller('api/institution')
export class InstitutionController {
  constructor(private readonly institutionService: InstitutionService) {}

  /** 实时行情快照（腾讯行情 qt.gtimg.cn 直连） */
  @Get('quote')
  async quote(@Query('code') code?: string) {
    if (!code) return { ok: false, error: '缺少 code 参数' };
    return this.institutionService.getQuote(code);
  }

  /** 北向资金个股持股 */
  @Get('north-holding')
  async northHolding(@Query('code') code?: string) {
    if (!code) return { ok: false, error: '缺少 code 参数' };
    return this.institutionService.getNorthHolding(code);
  }

  /** 主力资金流（近 N 日净流入） */
  @Get('fund-flow')
  async fundFlow(@Query('code') code?: string, @Query('days') days?: string) {
    if (!code) return { ok: false, error: '缺少 code 参数' };
    return this.institutionService.getFundFlow(code, Number(days) || 10);
  }

  /** 龙虎榜（机构席位） */
  @Get('lhb')
  async lhb(@Query('code') code?: string, @Query('limit') limit?: string) {
    if (!code) return { ok: false, error: '缺少 code 参数' };
    return this.institutionService.getLhb(code, Number(limit) || 5);
  }

  /** 机构评级与盈利预测 */
  @Get('rating')
  async rating(@Query('code') code?: string) {
    if (!code) return { ok: false, error: '缺少 code 参数' };
    return this.institutionService.getRating(code);
  }

  /** 研报列表 */
  @Get('report')
  async report(
    @Query('code') code?: string,
    @Query('days') days?: string,
    @Query('limit') limit?: string,
  ) {
    if (!code) return { ok: false, error: '缺少 code 参数' };
    return this.institutionService.getReport(code, Number(days) || 180, Number(limit) || 10);
  }

  /** 估值（PE/PB/市值） */
  @Get('valuation')
  async valuation(@Query('code') code?: string) {
    if (!code) return { ok: false, error: '缺少 code 参数' };
    return this.institutionService.getValuation(code);
  }

  /** 筹码分布（可能不可用 -> 优雅降级） */
  @Get('chip')
  async chip(@Query('code') code?: string) {
    if (!code) return { ok: false, error: '缺少 code 参数' };
    return this.institutionService.getChip(code);
  }

  /** 业绩同比（可能不可用 -> 优雅降级） */
  @Get('finance-yoy')
  async financeYoy(@Query('code') code?: string) {
    if (!code) return { ok: false, error: '缺少 code 参数' };
    return this.institutionService.getFinanceYoy(code);
  }
}
