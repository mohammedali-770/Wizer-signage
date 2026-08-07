import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Length, MaxLength, MinLength } from 'class-validator';

/**
 * Starting an impersonation requires BOTH a fresh second factor and a stated
 * reason. Neither is optional: the code binds the act to a person holding the
 * token right now, and the reason is what makes the audit entry answerable
 * later without a log dive.
 */
export class StartImpersonationDto {
  @ApiProperty({ format: 'uuid', description: 'The tenant to act inside.' })
  @IsUUID(undefined, { message: 'companyId must be a UUID.' })
  companyId!: string;

  /** TOTP code or a single-use backup code. */
  @ApiProperty({
    description:
      'A current TOTP or single-use backup code. Impersonation is re-authenticated even though ' +
      'the caller already holds a Super Admin session — entering a tenant is not something a ' +
      'stolen token should be able to do.',
    minLength: 6,
    maxLength: 32,
  })
  @IsString()
  @Length(6, 32, { message: 'A valid two-factor or backup code is required.' })
  twoFactorCode!: string;

  /**
   * Free text, but long enough to be a sentence — "test" is not a reason, and a
   * field that accepts it produces an audit trail nobody trusts.
   */
  @ApiProperty({
    description:
      'REQUIRED, minimum 10 characters — deliberately long enough to be a sentence. "test" is ' +
      'not a reason, and a field that accepts it produces an audit trail nobody trusts. Written ' +
      'to the activity log alongside the impersonation.',
    minLength: 10,
    maxLength: 500,
  })
  @IsString()
  @MinLength(10, { message: 'Give a reason of at least 10 characters.' })
  @MaxLength(500)
  reason!: string;
}
