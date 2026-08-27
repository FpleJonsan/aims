import { IsIn, IsOptional, Matches, MaxLength } from "class-validator";
import { REQUEST_STATUSES } from "../../domain/payment-request.js";

export class RequesterListDto {
  @IsOptional() @Matches(/^\d+$/) page?: string;
  @IsOptional() @Matches(/^\d+$/) pageSize?: string;
  @IsOptional() @IsIn(REQUEST_STATUSES) status?: string;
  @IsOptional() @MaxLength(100) search?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateFrom?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateTo?: string;
}
