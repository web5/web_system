import { DefaultNamingStrategy } from 'typeorm';
import { snakeCase } from 'typeorm/util/StringUtils';

/**
 * 统一 snake_case 命名策略。
 * 注册到各服务 DataSource 后，所有实体属性自动映射为下划线列名，
 * 无需在实体里逐字段写 name: 'xxx_yyy'。
 *
 * 用法（app.module.ts）：
 *   import { SnakeNamingStrategy } from '@web-system/shared';
 *   TypeOrmModule.forRootAsync({ useFactory: (cfg) => ({
 *     ...,
 *     namingStrategy: new SnakeNamingStrategy(),
 *   }) })
 */
export class SnakeNamingStrategy extends DefaultNamingStrategy {
  /** 表名：优先用 @Entity('custom')，否则类名转 snake_case */
  tableName(className: string, customName: string): string {
    return customName ? customName : snakeCase(className);
  }

  /** 列名：优先用 @Column({ name }) 显式指定，否则属性名转 snake_case */
  columnName(propertyName: string, customName: string, _embeddedPrefixes: string[]): string {
    return customName ? customName : snakeCase(propertyName);
  }

  relationName(propertyName: string): string {
    return snakeCase(propertyName);
  }

  joinColumnName(relationName: string, referencedColumnName: string): string {
    return snakeCase(relationName) + '_' + referencedColumnName;
  }

  joinTableName(firstTableName: string, secondTableName: string): string {
    return snakeCase(firstTableName) + '_' + snakeCase(secondTableName);
  }

  joinTableColumnName(tableName: string, propertyName: string, columnName?: string): string {
    return snakeCase(tableName) + '_' + (columnName ? columnName : snakeCase(propertyName));
  }

  classTableInheritanceParentColumnName(parentTableName: string, parentTableIdPropertyName: string): string {
    return snakeCase(parentTableName) + '_' + snakeCase(parentTableIdPropertyName);
  }
}
