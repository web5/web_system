import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 配置管理服务
 * 负责读取和写入环境配置文件
 * 配置文件位于 ENV_CONFIG_DIR 目录下
 */
@Injectable()
export class ConfigService_ {
  constructor(private readonly configService: ConfigService) {}

  /**
   * 获取配置文件根目录
   */
  private getConfigDir(): string {
    return this.configService.get<string>('ENV_CONFIG_DIR') || '/data/env_config';
  }

  /**
   * 获取 web_system 目录
   */
  private getWebSystemDir(): string {
    return this.configService.get<string>('WEB_SYSTEM_DIR') || '/data/web_system';
  }

  /**
   * 列出所有可用配置文件
   * 结构: ENV_CONFIG_DIR/servers.env + ENV_CONFIG_DIR/web_system/{dev,prod}.env
   */
  listFiles(): Array<{ name: string; env: string; path: string }> {
    const configDir = this.getConfigDir();
    const files: Array<{ name: string; env: string; path: string }> = [];

    // servers.env（服务器级通用配置）
    const serversPath = path.join(configDir, 'servers.env');
    if (fs.existsSync(serversPath)) {
      files.push({ name: 'servers.env', env: 'common', path: serversPath });
    }

    // web_system 项目级配置: ENV_CONFIG_DIR/web_system/{dev,prod}.env
    const webSystemEnvDir = path.join(configDir, 'web_system');
    if (fs.existsSync(webSystemEnvDir)) {
      for (const env of ['dev', 'prod']) {
        const envFile = path.join(webSystemEnvDir, `${env}.env`);
        if (fs.existsSync(envFile)) {
          files.push({ name: `${env}.env`, env, path: envFile });
        }
      }
      // 列出 web_system 目录下其他 .env 文件（如 dev.env.bak 等）
      const entries = fs.readdirSync(webSystemEnvDir);
      for (const entry of entries) {
        if (entry.endsWith('.env') && entry !== 'dev.env' && entry !== 'prod.env') {
          const fullPath = path.join(webSystemEnvDir, entry);
          if (!files.find(f => f.path === fullPath)) {
            files.push({ name: entry, env: 'common', path: fullPath });
          }
        }
      }
    }

    // 列出 ENV_CONFIG_DIR 根目录下其他 .env 文件
    const rootEntries = fs.readdirSync(configDir);
    for (const entry of rootEntries) {
      if (entry.endsWith('.env') && entry !== 'servers.env') {
        const fullPath = path.join(configDir, entry);
        if (!files.find(f => f.path === fullPath)) {
          files.push({ name: entry, env: 'common', path: fullPath });
        }
      }
    }

    return files;
  }

  /**
   * 读取单个配置文件内容
   */
  readFile(env: string, name: string): { name: string; content: string; env: string } {
    // 先尝试从文件列表中查找
    const files = this.listFiles();
    const file = files.find(f => f.env === env && f.name === name);

    if (!file) {
      throw new NotFoundException(`配置文件不存在: ${name} (env: ${env})`);
    }

    const content = fs.readFileSync(file.path, 'utf-8');
    return { name, content, env };
  }

  /**
   * 保存配置文件内容
   */
  saveFile(env: string, name: string, content: string): { name: string; env: string; saved: boolean } {
    const files = this.listFiles();
    const file = files.find(f => f.env === env && f.name === name);

    if (!file) {
      // 新文件创建到对应目录
      const configDir = this.getConfigDir();
      let targetPath: string;

      if (name === 'servers.env') {
        targetPath = path.join(configDir, name);
      } else if (env === 'dev' || env === 'prod') {
        targetPath = path.join(configDir, 'web_system', name);
      } else {
        targetPath = path.join(configDir, name);
      }

      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      fs.writeFileSync(targetPath, content, 'utf-8');
      return { name, env, saved: true };
    }

    fs.writeFileSync(file.path, content, 'utf-8');
    return { name, env, saved: true };
  }

  /**
   * 获取两个环境的简要信息
   */
  getEnvironments(): Array<{ env: string; server: string; services: number }> {
    const devServer = this.configService.get<string>('DEV_SERVER') || '';
    const prodServer = this.configService.get<string>('PROD_SERVER') || '';

    // 尝试从配置文件解析服务数量
    let devServices = 0;
    let prodServices = 0;

    try {
      const files = this.listFiles();
      for (const file of files) {
        const content = fs.readFileSync(file.path, 'utf-8');
        const serviceCount = (content.match(/^[^#].*_PORT/gm) || []).length;
        if (file.env === 'dev') devServices += serviceCount || 0;
        if (file.env === 'prod') prodServices += serviceCount || 0;
      }
    } catch {
      // 忽略读取错误
    }

    return [
      { env: 'dev', server: devServer, services: devServices || 9 },
      { env: 'prod', server: prodServer, services: prodServices || 9 },
    ];
  }
}
