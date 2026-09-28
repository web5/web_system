# 带宽升级操作手册（2026-09-28）

代码侧优化已到顶（首屏 gzip 957KB → 727KB），剩下的耗时 = 字节 ÷ 带宽。
本机出口实测只有 **~1Mbps**，这是当前唯一的量级瓶颈。

## 1. 现状拓扑（metadata 实测，勿凭文档推测）

| 角色 | 实例 | 地域 | 公网 | 内网 | 说明 |
|---|---|---|---|---|---|
| **gateway** | `ins-b3k2pze0` | 广州四区 | 42.194.200.69 | 172.16.16.15 | **所有域名的 TLS 入口**（www/admin/api/kedouai.com/dev.kedouai.com 都在此），响应头里的 nginx/1.20.2 来自它 |
| **prod** | `ins-0vx0sxl2` | 广州四区 | 106.52.176.246 | 172.16.16.2 | 与 gateway **同 VPC 同网段**；机器上没装 nginx，Node 直出 6000/6006 |
| **dev** | `ins-bndv9buo` | 南京三区 | 175.27.189.123 | — | 跨地域，gateway 只能走公网回源 |

两台目前都是**包年包月 + 1Mbps**（账单构成：运算组件 + 带宽 + 系统盘）。

## 2. 步骤 0（免费，收益最大，30 秒可回退）：回源改内网

gateway 的 nginx 里写的是 `proxy_pass http://106.52.176.246:6000|6006`（**公网 IP**）。实测：

- gateway → prod **内网**：5.7 MB/s（≈46Mbps，414KB 只用 72ms）
- gateway → prod **公网**：140 KB/s（≈1Mbps）

即生产链路被**两道 1Mbps 串联**卡死，而内网是免费的。

```bash
ssh root@42.194.200.69
cp -a /etc/nginx/conf.d /etc/nginx/conf.d.bak.$(date +%F)          # 备份
sed -i 's|http://106\.52\.176\.246:|http://172.16.16.2:|g' /etc/nginx/conf.d/*.conf
grep -rn '106\.52\.176\.246' /etc/nginx/conf.d/                    # 确认只剩注释里的
nginx -t && systemctl reload nginx
```

> ⚠️ 只改 **106.52.176.246**；**不要动 175.27.189.123**（dev 跨地域，走公网是对的）

回退：
```bash
cp -a /etc/nginx/conf.d.bak.<日期>/. /etc/nginx/conf.d/ && nginx -t && systemctl reload nginx
```

**执行结果（2026-09-28 20:1x）**：

- 改了 9 处 upstream（6000 × 6、6006 × 3），备份在 `/etc/nginx/conf.d.bak.2026-09-28`
- gateway → prod 内网：`antd.js` 414KB 仅 **29ms / 11.8 MB/s**（改前公网 140KB/s）
- `kedouai.com` / `kedouai.com/admin/` TTFB 降到 **~50ms**，www 200，mcp(6006) 401（鉴权需要，说明端口通）
- `dev.kedouai.com` 不受影响（200）
- ⚠️ `api.kedouai.com` 本就没有 DNS 记录（历史如此，前端走 `/api` 相对路径），与本次改动无关

## 3. 步骤 1 · gateway（必做，生产唯一出口）

控制台：云服务器 → 广州 → 实例 `ins-b3k2pze0` → 更多 → 网络/安全 → **调整公网计费**

| 方案 | 单价 | gateway 月成本 | 首屏效果 |
|---|---|---|---|
| **A 转按流量**（推荐） | ¥0.80/GB | 现在几乎 **¥0～20** | 上限拉满 → 亚秒级 |
| B 固定 5Mbps | 5Mbps = ¥115（补差 +¥95） | ¥115/月 | 727KB ≈ 1.2s |
| C 固定 10Mbps | 10Mbps = ¥565（补差 +¥545） | ¥565/月 | ≈0.6s |

选 A 时把**带宽上限**设 **30Mbps**（调上限不额外收费，只防被盗刷）。

## 4. 步骤 2 · dev —— **不做**（2026-09-28 决定）

`dev.kedouai.com` 是内部用，保持 1Mbps。它仍会经过 gateway 出网（跨地域只能走公网），
gateway 升完后 dev 也会顺带变快一些（首屏约 771KB ÷ gateway 带宽）。

## 5. 步骤 3 · prod —— **不用动**

改内网回源后，prod 公网只剩 SSH 与偶尔直连调试，1Mbps 足够，省下 ¥95/月。
⚠️ 只调 prod 公网带宽**不会让生产首屏变快**——用户流量从 gateway 出网。

## 6. 费用速算（按流量 ¥0.80/GB，首屏 727KB ≈ 0.71MB/次）

| 日访问量（首屏） | 月流量 | 按流量计费 | vs 固定 5Mbps(¥115) | vs CDN(¥0.21/GB) |
|---|---|---|---|---|
| 1,000 次/天 | ~21 GB | ¥17 | 省 | — |
| 5,000 次/天 | ~107 GB | ¥86 | 省 | ¥23 |
| 10,000 次/天 | ~213 GB | ¥170 | **超了** | ¥45 ← 该上 CDN |
| 30,000 次/天 | ~640 GB | ¥512 | 超很多 | ¥134 ← 必上 CDN |

**结论**：现在这个量级选「按流量」几乎不花钱；月流量超过 ~100GB 再上 CDN（CDN 境内 ¥0.21/GB + COS 回源 ¥0.15/GB）。

## 7. 操作前必看的三个坑

1. ⚠️ **按流量计费每台只能转换 1 次，且不可逆**（转不回按带宽）。低流量场景划算，但要想清楚。
2. 转换时会按「已购包月带宽 − 已使用（按小时折算）」**退还余额**，实际能回点血。
3. 按流量怕被盗刷/爬虫打爆 → 必须设带宽上限 + 开余额告警与流量告警（账号已有 Anti-DDoS 基础防护 ¥25/月）。

## 8. 验证（改完跑）

```bash
cd ~/workspace/web_system
./scripts/bench-first-paint.sh prod
./scripts/bench-first-paint.sh dev
```

**执行结果（2026-09-28 20:2x，gateway 转按流量 + 上限提高后复测）**：

| 指标 | 改前 | 改后 |
|---|---|---|
| gateway 单流吞吐 | 105 KB/s（0.84 Mbps） | **2.4～2.8 MB/s（19～22 Mbps）** |
| `kedouai.com` 首屏（1062KB gz） | 11.1 s | **0.4 s** |
| dev（未调，仍 1Mbps，符合决定） | 6.0 s | 5.4 s（720KB ÷ 1.1Mbps） |

## 8. 验证（改完跑）

```bash
cd ~/workspace/web_system
./scripts/bench-first-paint.sh prod
./scripts/bench-first-paint.sh dev
```

> ⚠️ 本机有 `HTTP_PROXY=127.0.0.1:56821`，curl 默认走代理会失真 —— 跑之前先
> `export no_proxy='*' NO_PROXY='*'`（或用 `--noproxy '*'`）。

| 指标 | 现在 | 做完步骤 0+1+2 |
|---|---|---|
| kedouai.com 首屏 | 1062KB / 0.8Mbps / **11.1s** | 分包 + 子集 + 带宽放开 → **~0.4s** |
| dev.kedouai.com 首屏 | 771KB / 1.1Mbps / **6.0s** | **~0.4s** |
| 新增月费 | — | **≈¥0～20**（按流量） |

## 9. 后续（月流量 >100GB 时）

静态资源（`/static/**`，含 CDN 依赖与模块产物）迁 COS + CDN：
- 项目已有 `__PUBLIC_ASSET_BASE__`（`/static/cdn/pub/`）机制可复用
- 需备案（已备案）
- 顺带降服务器负载，边缘节点比源站快

## 10. 顺带待确认

账号下 2026-09 新购一台**蜂驰型 BF1 在中国香港**（`ins-k6fj15eq`，未命名），不在任何链路里；
如果是闲置的，按小时计费会一直扣钱。
