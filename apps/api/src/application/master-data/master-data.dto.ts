import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

export class ListMasterDataDto {
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @Matches(/^\d+$/) page?: string;
  @IsOptional() @Matches(/^\d+$/) pageSize?: string;
  @IsOptional() @IsIn(["active", "disabled", "all"]) status?: "active" | "disabled" | "all";
}

export class CreateMasterDataDto {
  @IsString() @MinLength(1) @MaxLength(64) @Matches(/^[A-Za-z0-9._-]+$/) code!: string;
  @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @Matches(/^-?\d+$/) sortOrder?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdateMasterDataDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @Matches(/^-?\d+$/) sortOrder?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}
