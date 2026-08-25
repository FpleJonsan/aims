import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from "class-validator";

export const FINANCE_CONFIRMATION_CODES = [
  "PAYEE_VERIFIED",
  "PAYMENT_METHOD_VERIFIED",
  "PAYMENT_DETAILS_VERIFIED",
  "SUPPORTING_DOCUMENTS_VERIFIED",
  "POSSIBLE_DUPLICATE_REVIEWED",
] as const;
export type FinanceConfirmationCode =
  (typeof FINANCE_CONFIRMATION_CODES)[number];

export class FinanceConfirmationDto {
  @IsIn(FINANCE_CONFIRMATION_CODES) code!: FinanceConfirmationCode;
  @IsBoolean() confirmed!: boolean;
}
export class FinanceFinalizeDto {
  @IsUUID() commandKey!: string;
}
export class FinanceHoldResolutionDto {
  @IsIn(["RECHECK"]) resolution!: "RECHECK";
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: "note must contain non-whitespace characters" })
  @MaxLength(2000)
  note!: string;
}
