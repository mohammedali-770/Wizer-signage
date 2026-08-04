import { IsString, IsUUID, Length, MaxLength, MinLength } from 'class-validator';

/**
 * Starting an impersonation requires BOTH a fresh second factor and a stated
 * reason. Neither is optional: the code binds the act to a person holding the
 * token right now, and the reason is what makes the audit entry answerable
 * later without a log dive.
 */
export class StartImpersonationDto {
  @IsUUID(undefined, { message: 'companyId must be a UUID.' })
  companyId!: string;

  /** TOTP code or a single-use backup code. */
  @IsString()
  @Length(6, 32, { message: 'A valid two-factor or backup code is required.' })
  twoFactorCode!: string;

  /**
   * Free text, but long enough to be a sentence — "test" is not a reason, and a
   * field that accepts it produces an audit trail nobody trusts.
   */
  @IsString()
  @MinLength(10, { message: 'Give a reason of at least 10 characters.' })
  @MaxLength(500)
  reason!: string;
}
