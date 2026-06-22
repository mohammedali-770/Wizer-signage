import { IsString, Length, Matches } from 'class-validator';

export class VerifyTwoFactorCodeDto {
  /** A 6-digit TOTP code or a formatted backup code (e.g. ABCD-EFGH). */
  @IsString()
  @Length(6, 12)
  code!: string;
}

export class TotpCodeDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit authenticator code.' })
  code!: string;
}
