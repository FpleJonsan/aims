import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";
export class IntelligenceFilterDto {
  @IsOptional() @IsDateString() dateFrom?: string;
  @IsOptional() @IsDateString() dateTo?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsString() @MaxLength(100) category?: string;
}
export class AskAimsDto extends IntelligenceFilterDto {
  @IsString() @MinLength(2) @MaxLength(500) question!: string;
}
