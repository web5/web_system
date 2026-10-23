# 测试账号与数据

> 🔴 测试账号只用于 E2E 自动化，**不用于生产**。

## 测试账号

| 环境 | 用户名 | 密码来源 | 用途 |
|---|---|---|---|
| local | `testuser` | `tests/fixtures/.env.test`（不入库） | E2E 登录测试 |
| dev | `testuser` | `~/env_config/web_system/dev.env` 的 `TEST_USER_PASS` | 发布后冒烟 |

## 前置条件

1. 测试账号已注册（local 通过 seed 创建，dev 通过 admin 后台创建）
2. 本地后端服务在跑（`bash scripts/local-up.sh` 或各服务 pm2 start）
3. MySQL 可用（`web_system_deploy` 库）

## .env.test 模板

```bash
# 复制为 tests/fixtures/.env.test 并填写（不入库）
TEST_USER_NAME=testuser
TEST_USER_PASS=
```

## 种子数据

测试数据不依赖特定种子。冒烟测试只验证"链路通"，不断言具体业务数据。
