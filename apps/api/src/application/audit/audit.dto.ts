import { IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength } from "class-validator";

export class AuditQueryDto {
  @IsOptional() @Matches(/^\d+$/) page?:string;
  @IsOptional() @Matches(/^\d+$/) pageSize?:string;
  @IsOptional() @IsISO8601({strict:true}) dateFrom?:string;
  @IsOptional() @IsISO8601({strict:true}) dateTo?:string;
  @IsOptional() @IsUUID() actorId?:string;
  @IsOptional() @IsString() @MaxLength(32) role?:string;
  @IsOptional() @IsString() @MaxLength(80) action?:string;
  @IsOptional() @IsString() @MaxLength(80) entityType?:string;
  @IsOptional() @IsUUID() entityId?:string;
}
