import { IsString, IsOptional, IsUUID, MaxLength } from 'class-validator';

export class AgentRunDto {
  @IsString({ message: 'agentId 必须是字符串' })
  agentId: string;

  @IsString({ message: 'userInput 必须是字符串' })
  @MaxLength(8000, { message: 'userInput 过长（上限 8000 字符）' })
  userInput: string;

  @IsOptional()
  @IsUUID('4', { message: 'conversationId 必须是 UUID' })
  conversationId?: string;
}
