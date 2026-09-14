import { IsDateString, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from "class-validator";

export class CreateApprovalDelegationDto {
  @IsUUID() delegateFrom!: string;
  @IsUUID() delegateTo!: string;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}

export class CancelApprovalDelegationDto {
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}

export class ListApprovalDelegationsDto {
  @IsOptional() @IsIn(["SCHEDULED", "ACTIVE", "EXPIRED", "CANCELLED"]) effectiveStatus?: string;
  @IsOptional() @IsUUID() delegateFrom?: string;
  @IsOptional() @IsUUID() delegateTo?: string;
  @IsOptional() @Matches(/^\d+$/) page?: string;
  @IsOptional() @Matches(/^\d+$/) pageSize?: string;
}
