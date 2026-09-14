import { IsInt, IsObject, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from "class-validator";

export class SaveApprovalMatrixDraftDto {
  @IsObject() payload!: Record<string, unknown>;
}

export class PublishApprovalMatrixDto {
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}

export class RollbackApprovalMatrixDto {
  @IsInt() @Min(1) targetVersion!: number;
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}

export class ListApprovalMatrixVersionsDto {
  @IsOptional() @Matches(/^\d+$/) page?: string;
  @IsOptional() @Matches(/^\d+$/) pageSize?: string;
}
