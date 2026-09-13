import { IsBoolean, IsEmail, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";

export class RegisterDto {
  @IsEmail() @MaxLength(320) email!: string;
  @IsString() @MinLength(12) @MaxLength(200) password!: string;
  @IsString() @MinLength(1) @MaxLength(160) displayName!: string;
  @IsUUID() departmentId!: string;
}

export class LoginDto {
  @IsEmail() @MaxLength(320) email!: string;
  @IsString() @MinLength(1) @MaxLength(200) password!: string;
  @IsOptional() @IsBoolean() rememberMe?: boolean;
}

export class ForgotPasswordDto {
  @IsEmail() @MaxLength(320) email!: string;
}

export class ResetPasswordDto {
  @IsString() @MinLength(32) @MaxLength(512) token!: string;
  @IsString() @MinLength(12) @MaxLength(200) newPassword!: string;
}
