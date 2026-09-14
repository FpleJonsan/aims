import { IsBoolean, IsISO8601, IsOptional } from "class-validator";

export class SetNotificationPreferenceDto {
  @IsBoolean() enabled!: boolean;
  @IsOptional() @IsISO8601() mutedUntil?: string | null;
}

export class NotificationHistoryQueryDto {
  @IsOptional() page?: string;
  @IsOptional() pageSize?: string;
  @IsOptional() eventType?: string;
  @IsOptional() status?: string;
}
