import { IsDateString, IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';

export const CLAIM_CURRENCIES = ['MYR', 'USD', 'SGD', 'EUR', 'GBP'] as const;

// amount/currency/category are no longer captured here -- they are derived
// from the request's Claim Items (see ../claim-items). This DTO now only
// captures the fields that describe the request itself, independent of its
// claim breakdown.
export class CapturePaymentRequestDto {
  @IsOptional() @IsString() @MaxLength(200) payee?: string;
  @IsOptional() @IsString() @MaxLength(1000) purpose?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsDateString({ strict: true }) dueDate?: string;
  @IsOptional() @IsString() @Length(1, 64) paymentMethod?: string;
  @IsOptional() @IsString() @MaxLength(2000) paymentDetails?: string;
  @IsOptional() @IsString() @MaxLength(2000) remark?: string;
}

export class ListPaymentRequestsDto {
  @IsOptional() @Matches(/^\d+$/) page?: string;
  @IsOptional() @Matches(/^\d+$/) pageSize?: string;
  @IsOptional() @IsIn(['DRAFT', 'SUBMITTED', 'CANCELLED']) status?: string;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}

export class CancelPaymentRequestDto {
  @IsString() @Matches(/\S/) @MaxLength(2000) reason!: string;
  @IsUUID() commandKey!: string;
}
