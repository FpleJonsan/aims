import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

export class CreatePolicySetDto {
  @IsString() @Length(1, 64) code!: string;
  @IsString() @Length(1, 160) name!: string;
  @IsOptional() @IsString() @Length(1, 1000) description?: string;
}
export class CreatePolicyVersionDto {
  @IsDateString() effectiveFrom!: string;
  @IsOptional() @IsDateString() effectiveTo?: string;
}
export class ApprovalStepDto {
  @IsInt() @Min(1) sequence!: number;
  @IsString() @Length(1, 64) requiredRole!: string;
  @IsIn(["DEPARTMENT", "ORGANIZATION"]) authorityScope!: string;
  @IsOptional() @IsString() minimumAmountMinor?: string;
  @IsOptional() @IsString() maximumAmountMinor?: string;
  @IsOptional() @IsUUID() departmentScope?: string;
  @IsBoolean() mandatory!: boolean;
  @IsString() @Length(1, 500) reason!: string;
}
export class CreatePolicyRuleDto {
  @IsString() @Length(1, 64) code!: string;
  @IsString() @Length(1, 160) name!: string;
  @IsInt() @Min(1) @Max(10000) priority!: number;
  @IsIn(["REQUIRE_APPROVAL", "ALLOW_NO_APPROVAL", "REQUIRE_JUSTIFICATION"])
  effect!: string;
  @IsObject() conditions!: Record<string, unknown>;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApprovalStepDto)
  approvalSteps!: ApprovalStepDto[];
  @IsArray() @IsString({ each: true }) requiredEvidence!: string[];
  @IsOptional() @IsString() @Length(1, 500) escalation?: string;
  @IsOptional() @IsObject() notificationMetadata?: Record<string, string>;
  @IsBoolean() autoApprovalEligible!: boolean;
  @IsOptional() @IsString() @Length(1, 64) exceptionCode?: string;
  @IsOptional() @IsString() @Length(1, 1000) exceptionReason?: string;
  @IsOptional()
  @IsIn(["REQUESTER", "FINANCE", "ADMIN"])
  justificationRole?: string;
}
export class PolicyJustificationDto {
  @IsString() @Length(1, 4000) justification!: string;
}
