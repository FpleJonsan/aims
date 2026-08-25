import { Type } from "class-transformer";
import { IsBoolean, IsDateString, IsIn, IsOptional, IsString, IsUUID, Length, MaxLength, Min } from "class-validator";

export class RecordPaymentDto {
  @IsUUID() commandKey!: string;
  @IsDateString() paymentDate!: string;
  @IsString() @Length(1, 30) amount!: string;
  @IsString() @Length(3, 3) currency!: string;
  @IsString() @Length(1, 200) bankReference!: string;
  @IsUUID() slipDocumentId!: string;
  @IsOptional() @IsBoolean() confirmPossibleDuplicate = false;
}

export class PaymentListDto {
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsString() @MaxLength(100) category?: string;
  @IsOptional() @IsDateString() dateFrom?: string;
  @IsOptional() @IsDateString() dateTo?: string;
  @IsOptional() @IsIn(["PAID"]) status?: string;
  @IsOptional() @IsString() @MaxLength(200) payee?: string;
  @IsOptional() @Type(() => Number) @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @Min(1) pageSize = 25;
}
