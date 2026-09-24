import { SetMetadata } from '@nestjs/common';

/**
 * 免鉴权标记：metadata key 与既有 6 份服务内实现完全一致（'isPublic'），
 * 因此新增/替换后各服务薄 guard（AuthGuard / JwtAuthGuard）无需改动即可识别。
 *
 * 下沉到共享包的原因：此前 gateway / ai-service / ai-agent / knowledge-service /
 * system-service / deploy-console 各有一份本地实现，其余 6 个服务没有，
 * 新增统一探活端点时无从复用。见 specs/backend-health-endpoint/design.md §3.1。
 *
 * 注意：只下沉纯函数装饰器（SetMetadata）。守卫/异常类不要下沉 ——
 * pnpm 隔离下共享包与服务可能是两份 @nestjs/common 实例，HttpException
 * 子类会被误判成 500。
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
