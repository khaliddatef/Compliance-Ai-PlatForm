import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ChatRequestDto {
  @IsOptional()
  @IsString()
  @IsUUID('4', { message: 'conversationId must be a valid uuid' })
  conversationId?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(5000)
  message!: string;
}
