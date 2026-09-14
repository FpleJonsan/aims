import { IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { CONFIGURATION_CATEGORIES } from "./configuration.types.js";

export class SaveDraftDto {
  @IsObject() payload!: Record<string, unknown>;
}

export class PublishConfigurationDto {
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class RollbackConfigurationDto {
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class ListConfigurationVersionsDto {
  @IsOptional() @IsIn(CONFIGURATION_CATEGORIES as unknown as string[]) category?: string;
}
