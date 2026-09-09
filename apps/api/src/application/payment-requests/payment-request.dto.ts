import { IsDateString, IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';

const CURRENCIES = ['MYR', 'USD', 'SGD', 'EUR', 'GBP'] as const;

export class CapturePaymentRequestDto {
  @IsOptional() @IsString() @MaxLength(200) payee?: string;
  @IsOptional() @IsString() @MaxLength(1000) purpose?: string;
  @IsOptional() @IsString() @MaxLength(100) category?: string;
  @IsOptional() @Matches(/^\d+(\.\d{1,4})?$/) amount?: string;
  @IsOptional() @IsIn(CURRENCIES) currency?: string;
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
