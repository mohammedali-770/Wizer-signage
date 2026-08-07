import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

/**
 * Re-authentication for the 2FA management routes.
 *
 * A bearer token proves a session exists. It does NOT prove the person holding
 * it is the account owner — a stolen token is exactly the case these routes
 * must survive, because enrolling an authenticator is how an attacker converts
 * a borrowed session into permanent access that outlives a password reset.
 *
 * `password` is therefore required on every route in this module. `currentCode`
 * is required *in addition* whenever 2FA is already enabled: on such an account
 * the password is one factor of two, so accepting it alone would let a stolen
 * password defeat the second factor. `@IsOptional()` here is a shape rule only
 * — the service rejects a missing code when the account has 2FA on.
 *
 * `MaxLength(200)` matches LoginDto: Argon2 verification is deliberately
 * expensive, so an unbounded string is a CPU amplifier.
 */
export class ReauthDto {
  @ApiProperty({
    description:
      "The signed-in user's own password. Required on every route in this module — a bearer " +
      'token alone no longer authorises changing the second factor.',
  })
  @IsString()
  @MaxLength(200)
  password!: string;

  /**
   * A current TOTP or backup code. Required when 2FA is already enabled;
   * ignored when it is not.
   */
  @ApiPropertyOptional({
    description:
      'A TOTP or backup code from the authenticator currently enrolled. REQUIRED when the ' +
      'account already has 2FA on, and rejected as missing if omitted then; ignored otherwise. ' +
      'Optional in the schema because whether it is needed depends on account state, not shape.',
  })
  @IsOptional()
  @IsString()
  @Length(6, 12)
  currentCode?: string;
}

/** POST /auth/2fa/setup — begin (or restart) enrollment. */
export class BeginTwoFactorSetupDto extends ReauthDto {}

/** POST /auth/2fa/disable. `code` proves possession of the factor being removed. */
export class VerifyTwoFactorCodeDto extends ReauthDto {
  @ApiProperty({
    description:
      'A 6-digit TOTP code or a formatted backup code (e.g. ABCD-EFGH), proving possession of ' +
      'the factor being removed. Send `password` as well; `currentCode` is not needed here ' +
      'because this field already is the current code.',
    example: '123456',
  })
  @IsString()
  @Length(6, 12)
  code!: string;
}

/**
 * POST /auth/2fa/enable.
 *
 * `code` comes from the NEW authenticator being enrolled and is checked against
 * the pending secret. `currentCode` (inherited) comes from the OLD one and is
 * checked against the stored secret. They are different credentials and must
 * not be collapsed into one field.
 */
export class EnableTwoFactorDto extends ReauthDto {
  @ApiProperty({
    description:
      'A 6-digit code from the NEW authenticator, checked against the pending secret. Distinct ' +
      'from `currentCode`, which comes from the old one.',
    example: '123456',
  })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit authenticator code.' })
  code!: string;
}
