import { Type } from "class-transformer";
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Max,
  Min,
} from "class-validator";
export class DashboardFilterDto {
  @IsOptional() @IsDateString() dateFrom?: string;
  @IsOptional() @IsDateString() dateTo?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsString() @MaxLength(100) category?: string;
  @IsOptional() @Type(() => Number) @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @Min(1) @Max(100) pageSize = 25;
}
export class ReportingRequestFilterDto extends DashboardFilterDto {
  @IsIn(["PENDING_APPROVAL", "RISK_ATTENTION"])
  view!: "PENDING_APPROVAL" | "RISK_ATTENTION";
}
