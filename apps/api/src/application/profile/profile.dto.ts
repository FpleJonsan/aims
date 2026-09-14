import { IsIn, IsString, MaxLength, MinLength } from "class-validator";

export class UpdateProfileDto {
  @IsString() @MinLength(1) @MaxLength(160) displayName!: string;
  @IsString() @IsIn(["en"]) language!: string;
}
