/// <reference types="vite/client" />

/**
 * Vite 客户端类型（import.meta.env / import.meta.glob 等）。
 *
 * 本文件为 Vite 脚手架标准产物；portal 此前缺失，导致
 * `Property 'env' does not exist on type 'ImportMeta'`（AppNavbar / LoginPanel / utils/wechat）。
 * 采用「新增引用文件」而非 tsconfig `types` 白名单，避免收窄全局类型自动包含范围。
 */
