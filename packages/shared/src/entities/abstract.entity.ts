import {
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

/**
 * 统一基础实体：所有业务表的公共时间戳与软删除字段。
 * 配合 SnakeNamingStrategy，物理列自动映射为 snake_case：
 *   createdAt -> created_at / updatedAt -> updated_at / deletedAt -> deleted_at
 *
 * 主键由各实体自行声明（核心表 BIGINT 自增 / 日志资讯类 uuid）。
 */
export abstract class AbstractEntity {
  // 注意：MySQL 8.4 严格模式下，@CreateDateColumn/@UpdateDateColumn 生成的默认值
  // 固定为 CURRENT_TIMESTAMP(6)，必须与列精度一致，否则报
  // "Invalid default value for 'created_at'"。故精度统一为 6。
  @CreateDateColumn({
    type: 'datetime',
    precision: 6,
    comment: '创建时间',
  })
  createdAt: Date;

  @UpdateDateColumn({
    type: 'datetime',
    precision: 6,
    comment: '更新时间',
  })
  updatedAt: Date;

  @DeleteDateColumn({
    type: 'datetime',
    precision: 6,
    nullable: true,
    comment: '软删除时间，NULL 表示未删除',
  })
  deletedAt?: Date | null;
}

/**
 * 核心业务表主键：BIGINT UNSIGNED 自增。
 * 适用于用户、素材、作品、待办、MCP、操作日志等。
 */
export abstract class BigIntEntity extends AbstractEntity {
  // 由各实体用 @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true }) 声明 id
}

/**
 * 日志/资讯类主键：uuid(CHAR36)。
 * 适用于财经资讯、对话、变身记录等分布式写入场景。
 */
export abstract class UuidEntity extends AbstractEntity {
  // 由各实体用 @PrimaryGeneratedColumn('uuid') 声明 id
}
