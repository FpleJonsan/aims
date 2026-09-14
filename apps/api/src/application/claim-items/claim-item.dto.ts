import { ArrayMinSize, IsArray, IsIn, IsISO8601, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CLAIM_CURRENCIES } from '../payment-requests/payment-request.dto.js';

// A claim item's core accounting fields (category/department/currency/amount)
// mirror the payment_requests row-level CHECK constraints (NOT NULL) -- a
// claim is created with these already set, unlike the parent request which
// is allowed to start blank and be filled in over several PATCHes.
export class CreateClaimItemDto {
  @IsOptional() @IsString() @MaxLength(100) invoiceNumber?: string;
  @IsOptional() @IsISO8601({ strict: true }) invoiceDate?: string;
  @IsString() @MaxLength(100) category!: string;
  @IsOptional() @IsUUID() projectId?: string;
  @IsUUID() departmentId!: string;
  @IsIn(CLAIM_CURRENCIES) currency!: string;
  @Matches(/^\d+(\.\d{1,4})?$/) amount!: string;
  @IsOptional() @Matches(/^\d+(\.\d{1,4})?$/) taxAmount?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsString() @MaxLength(2000) remark?: string;
  @IsOptional() @IsString() @MaxLength(64) paymentMethod?: string;
}

export class UpdateClaimItemDto {
  @IsOptional() @IsString() @MaxLength(100) invoiceNumber?: string;
  @IsOptional() @IsISO8601({ strict: true }) invoiceDate?: string;
  @IsOptional() @IsString() @MaxLength(100) category?: string;
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsIn(CLAIM_CURRENCIES) currency?: string;
  @IsOptional() @Matches(/^\d+(\.\d{1,4})?$/) amount?: string;
  @IsOptional() @Matches(/^\d+(\.\d{1,4})?$/) taxAmount?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsString() @MaxLength(2000) remark?: string;
  @IsOptional() @IsString() @MaxLength(64) paymentMethod?: string;
}

class ReorderEntryDto {
  @IsUUID() id!: string;
  @IsInt() @Min(0) displayOrder!: number;
}

export class ReorderClaimItemsDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ReorderEntryDto)
  items!: ReorderEntryDto[];
}
