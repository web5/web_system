import { Entity, PrimaryColumn, Column } from 'typeorm';

/**
 * 权限点定义（代码声明，启动 seed 写入）。
 * 注意：列名用 grp 而非 group —— group 是 SQL 保留字，避免建表/查询异常。
 */
@Entity('permissions')
export class PermissionEntity {
  /** 权限点 code，如 agents:manage */
  @PrimaryColumn({ type: 'varchar', length: 64, comment: '权限点 code' })
  code: string;

  /** 权限名 */
  @Column({ type: 'varchar', length: 64, comment: '权限名' })
  name: string;

  /** 分组：dashboard/users/settings/logs/mcp/agents */
  @Column({ type: 'varchar', length: 32, name: 'grp', comment: '权限分组' })
  grp: string;

  /** menu=菜单入口 / action=按钮操作 / api=接口权限 */
  @Column({ type: 'varchar', length: 16, default: 'action', comment: '权限类型 menu/action/api' })
  type: string;

  /** 组内排序 */
  @Column({ type: 'int', default: 0, comment: '排序' })
  sort: number;
}
