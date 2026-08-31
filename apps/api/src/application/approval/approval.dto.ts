import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Max,
  Matches,
  Min,
} from "class-validator";
import { Type } from "class-transformer";

export class ApprovalInboxDto {
  @IsOptional() @Type(() => Number) @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @Min(1) @Max(100) pageSize = 25;
}

export interface ApprovalInboxPage<T = Record<string, unknown>> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

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
  @IsString() @IsNotEmpty() @MaxLength(16) @Matches(/^[1-9][0-9]{0,15}$/)
  telegramUserId!: string;
  @IsString() @IsNotEmpty() @MaxLength(16) @Matches(/^[1-9][0-9]{0,15}$/)
  telegramChatId!: string;
}
export class TelegramBindingChallengeDto {
  @IsUUID() userId!: string;
}
