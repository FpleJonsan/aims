import { ArrayUnique, IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from "class-validator";

export const COARSE_ROLES = ["REQUESTER", "FINANCE", "FINANCE_MASTER"] as const;
export type CoarseRole = (typeof COARSE_ROLES)[number];

export class ListUsersDto {
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @Matches(/^\d+$/) page?: string;
  @IsOptional() @Matches(/^\d+$/) pageSize?: string;
}

export class CreateUserDto {
  @IsEmail() @MaxLength(320) email!: string;
  @IsString() @MinLength(1) @MaxLength(160) displayName!: string;
  @IsUUID() departmentId!: string;
  @IsArray() @ArrayUnique() @IsIn(COARSE_ROLES, { each: true }) roles!: CoarseRole[];
}

export class AssignRolesDto {
  @IsArray() @ArrayUnique() @IsIn(COARSE_ROLES, { each: true }) roles!: CoarseRole[];
}

export class ApprovalAuthorityDto {
  @IsString() @MinLength(1) @MaxLength(64) authorityRole!: string;
  @IsIn(["DEPARTMENT", "ORGANIZATION"]) authorityScope!: "DEPARTMENT" | "ORGANIZATION";
  @IsBoolean() active!: boolean;
}
