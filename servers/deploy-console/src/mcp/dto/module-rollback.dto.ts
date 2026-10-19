import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class ModuleRollbackDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]+$/)
  env: string;

  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)
  component: string;

  @IsString()
  @MaxLength(128)
  @Matches(/^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*$/)
  versionTag: string;

  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}
