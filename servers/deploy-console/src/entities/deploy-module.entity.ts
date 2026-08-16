import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm';

/**
 * 模块注册表（可部署单元）。
 * 一切发布/版本/部署记录都以 key 关联：
 * - deploy_versions.component
 * - deploy_deployments.moduleKey
 * 未来微前端：type = micro-frontend 的模块，其构建产物落在
 * gateway public/versions/<publicPath>/<version>/ 下，基座通过
 * GET /__version__?module=<key> 解析当前版本入口远程加载。
 */
@Entity('deploy_modules')
export class DeployModuleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 模块 key（唯一，与版本/部署记录关联） */
  @Column({ type: 'varchar', length: 64, comment: '模块 key' })
  @Index({ unique: true })
  key: string;

  /** 模块名称 */
  @Column({ type: 'varchar', length: 128, comment: '模块名称' })
  name: string;

  /** 类型: backend | frontend | micro-frontend | mini-app */
  @Column({ type: 'varchar', length: 32, comment: '类型 backend/frontend/micro-frontend/mini-app' })
  type: string;

  /** 仓库内目录名（servers/ 或 apps/ 下） */
  @Column({ type: 'varchar', length: 128, comment: '仓库内目录' })
  dir: string;

  /** 后端 pm2 进程名 */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: 'pm2 进程名' })
  pm2?: string;

  /** 前端 public 子路径（portal/admin/mcp-admin，也是版本目录名） */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '前端 public 子路径' })
  publicPath?: string;

  /** 自定义构建命令（缺省 npx vite build） */
  @Column({ type: 'varchar', length: 255, nullable: true, comment: '自定义构建命令' })
  buildCmd?: string;

  /** 微前端远程入口文件（如 remoteEntry.js） */
  @Column({ type: 'varchar', length: 128, nullable: true, comment: '微前端远程入口' })
  entry?: string;

  /** 完整入口 URL（COS 时覆盖相对 entry，如 https://cdn.example.com/modules/portal/v1/index.js） */
  @Column({ type: 'varchar', length: 512, nullable: true, comment: '完整入口 URL（COS 时覆盖）' })
  entryUrl?: string;

  /** 模块 externals 清单（覆盖默认 externals，JSON） */
  @Column({ type: 'json', nullable: true, comment: '模块 externals 清单（覆盖默认）' })
  externals?: Record<string, string>;

  /** 是否基座（shell），基座不参与模块清单注入 */
  @Column({ type: 'boolean', default: false, comment: '是否基座 shell' })
  isShell?: boolean;

  /** 描述 */
  @Column({ type: 'varchar', length: 255, nullable: true, comment: '描述' })
  description?: string;

  /** 内置模块（种子导入，不可删除） */
  @Column({ type: 'boolean', default: false, comment: '内置模块不可删' })
  builtin: boolean;

  /** 是否启用 */
  @Column({ type: 'boolean', default: true, comment: '是否启用' })
  enabled: boolean;

  @Column({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)', comment: '创建时间' })
  createdAt: Date;

  @Column({
    type: 'datetime',
    precision: 3,
    default: () => 'CURRENT_TIMESTAMP(3)',
    onUpdate: 'CURRENT_TIMESTAMP(3)',
    comment: '更新时间',
  })
  updatedAt: Date;
}
