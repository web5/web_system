import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

/** 主机组名：小写字母/数字/短横线，作为 `deploy_service_envs.host_name` 的引用键 */
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** 新建主机（组） */
export class CreateHostDto {
  @IsString()
  @Length(1, 64)
  @Matches(NAME_RE, { message: '主机组名只能由小写字母、数字与短横线组成（如 dev-default）' })
  name: string;

  /** SSH 主机（IP 或域名） */
  @IsString()
  @Length(1, 128)
  host: string;

  @IsString()
  @Length(1, 64)
  sshUser: string;

  @IsOptional()
  @IsString()
  @Length(0, 255)
  sshKeyPath?: string;

  @IsString()
  @Length(1, 255)
  remoteDir: string;

  @IsOptional()
  @IsIn(['pm2', 'docker'])
  runtime?: 'pm2' | 'docker';

  /** 主机形态：local=本机形态 / cloud=云服务器 / container=容器服务器（默认 cloud） */
  @IsOptional()
  @IsIn(['local', 'cloud', 'container'])
  scope?: 'local' | 'cloud' | 'container';

  /** 归属控制台实例（对应 CONSOLE_INSTANCE）；留空 = 所有控制台可见 */
  @IsOptional()
  @IsString()
  @Length(0, 64)
  managedBy?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/** 更新主机（组名是引用键，**不可改**） */
export class UpdateHostDto {
  @IsOptional()
  @IsString()
  @Length(1, 128)
  host?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  sshUser?: string;

  @IsOptional()
  @IsString()
  @Length(0, 255)
  sshKeyPath?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  remoteDir?: string;

  @IsOptional()
  @IsIn(['pm2', 'docker'])
  runtime?: 'pm2' | 'docker';

  @IsOptional()
  @IsIn(['local', 'cloud', 'container'])
  scope?: 'local' | 'cloud' | 'container';

  @IsOptional()
  @IsString()
  @Length(0, 64)
  managedBy?: string | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
