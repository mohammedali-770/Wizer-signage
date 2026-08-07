import { ApiProperty } from '@nestjs/swagger';
import { PASSWORD_POLICY } from '@wizer/shared';
import { IsEmail, IsString, Length, MaxLength, MinLength } from 'class-validator';

/**
 * Request bodies for the authentication routes.
 *
 * `class-validator` decorators are not swagger metadata: `@MinLength(10)` tells
 * the runtime everything and the contract nothing. Each field below therefore
 * carries an `@ApiProperty` as well — and where the two could disagree, the
 * description states the rule that is ACTUALLY enforced.
 *
 * That gap is not hypothetical here. Password fields are validated twice: once
 * by the decorator, then again by `PasswordService.evaluate()` inside the
 * service, which applies complexity, a known-common/breached list, and
 * immediate-reuse prevention. Publishing only the decorator would tell clients a
 * rule the API does not use.
 */

/**
 * The full policy, built from the shared constant rather than retyped.
 *
 * `PASSWORD_POLICY.description` is the same string the API returns in its 400,
 * so the contract and the error a user actually sees cannot drift apart.
 */
const PASSWORD_RULE =
  `${PASSWORD_POLICY.description} Also rejected: passwords on the common/breached list, ` +
  'and reusing your current password. Enforced server-side by PasswordService, so the ' +
  'length below is the floor, not the whole rule.';

export class LoginDto {
  @ApiProperty({ format: 'email', example: 'owner@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({
    description:
      'Deliberately carries NO minimum length and NO policy. Sign-in must be able to ATTEMPT ' +
      'any password, including one set before the policy existed; imposing the rule here would ' +
      'lock those accounts out of their own account, surfacing as "invalid credentials" for a ' +
      'password that is correct. The cap is a DoS bound — Argon2 verification is expensive.',
    maxLength: 200,
  })
  @IsString()
  @MaxLength(200)
  password!: string;
}

export class TwoFactorLoginDto {
  @ApiProperty({
    description:
      'The short-lived token returned by POST /auth/login when the account has 2FA. It is NOT ' +
      'an access token and carries no authority of its own; it is single-use and tied to a ' +
      'server-side challenge record.',
  })
  @IsString()
  challengeToken!: string;

  @ApiProperty({
    description:
      'A 6-digit TOTP code OR a formatted backup code (e.g. ABCD-EFGH) — hence the 6..12 range ' +
      'rather than a 6-digit pattern.',
    minLength: 6,
    maxLength: 12,
    example: '123456',
  })
  @IsString()
  @Length(6, 12)
  code!: string;
}

export class RefreshTokenDto {
  @ApiProperty({
    description:
      'The refresh token from the last token pair. Rotated on every use: the one sent here is ' +
      'invalidated, and presenting it a second time is treated as theft and revokes the session.',
  })
  @IsString()
  refreshToken!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({
    format: 'email',
    description:
      'The response is identical whether or not this address exists, so it cannot be used to ' +
      'enumerate accounts. A 200 here does not mean an email was sent.',
    example: 'owner@example.com',
  })
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({
    description: 'The single-use token from the reset email. Expires one hour after issue.',
  })
  @IsString()
  token!: string;

  @ApiProperty({
    description: PASSWORD_RULE,
    minLength: PASSWORD_POLICY.minLength,
    maxLength: 200,
  })
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  password!: string;
}

export class AcceptInvitationDto {
  @ApiProperty({
    description: 'The single-use token from the invitation email. Expires three days after issue.',
  })
  @IsString()
  token!: string;

  @ApiProperty({ maxLength: 120, example: 'Alex Morgan' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({
    description: PASSWORD_RULE,
    minLength: PASSWORD_POLICY.minLength,
    maxLength: 200,
  })
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  password!: string;
}
