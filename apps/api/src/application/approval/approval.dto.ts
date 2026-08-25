import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from "class-validator";

export class ApprovalActionDto {
  @IsUUID() commandKey!: string;
  @IsIn(["APPROVE", "REJECT", "REQUEST_CLARIFICATION"])
  action!: "APPROVE" | "REJECT" | "REQUEST_CLARIFICATION";
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
  @IsOptional() @IsString() @MaxLength(2000) requiredResponse?: string;
}
export class ApprovalClarificationResponseDto {
  @IsString() @IsNotEmpty() @MaxLength(4000) response!: string;
}
export class TelegramBindingDto {
  @IsUUID() userId!: string;
  @IsString() @IsNotEmpty() telegramUserId!: string;
  @IsString() @IsNotEmpty() telegramChatId!: string;
}
