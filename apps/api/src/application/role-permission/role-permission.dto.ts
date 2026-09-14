import { ArrayUnique, IsArray, IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";

export class ListRolesDto {
  @IsOptional() @IsString() @MaxLength(200) search?: string;
}

export class CreateRoleDto {
  @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsArray() @ArrayUnique() @IsUUID(undefined, { each: true }) permissionIds?: string[];
}

export class UpdateRoleDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsBoolean() disabled?: boolean;
}

export class CloneRoleDto {
  @IsString() @MinLength(1) @MaxLength(160) name!: string;
}

export class SetRolePermissionsDto {
  @IsArray() @ArrayUnique() @IsUUID(undefined, { each: true }) permissionIds!: string[];
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
