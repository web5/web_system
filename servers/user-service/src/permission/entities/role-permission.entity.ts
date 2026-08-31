import { Entity, PrimaryColumn } from 'typeorm';

/** 角色-权限 关联（联合主键） */
@Entity('role_permissions')
export class RolePermissionEntity {
  @PrimaryColumn({ type: 'varchar', length: 64, comment: '角色 code' })
  roleCode: string;

  @PrimaryColumn({ type: 'varchar', length: 64, comment: '权限点 code' })
  permissionCode: string;
}
