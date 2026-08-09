import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { UserViewDto } from '../../../common/dto/api-response.dto';

/**
 * Auth response shapes for the OpenAPI contract. See
 * `common/dto/api-response.dto.ts` for why these are classes and not the
 * interfaces the service already returns.
 */

/**
 * A completed browser login. The refresh token is deliberately NOT part of the
 * JSON response: AuthController writes it to an HttpOnly, Secure (production),
 * SameSite=Strict cookie scoped to /api/auth/refresh. JavaScript only receives
 * the short-lived access token.
 */
export class AuthTokensDto {
  @ApiProperty({ description: 'Short-lived bearer token for the Authorization header.' })
  accessToken!: string;

  @ApiProperty({ type: UserViewDto })
  user!: UserViewDto;

  @ApiPropertyOptional({
    description:
      'True when the account must enrol in 2FA before it has full access — a Super Admin, ' +
      'or a user whose company enforces it. The session is confined to the enrollment routes ' +
      'until it does.',
  })
  mustEnableTwoFactor?: boolean;
}

/**
 * The OTHER thing POST /auth/login can return.
 *
 * A login that needs a second factor does NOT return tokens; it returns a
 * short-lived challenge to be exchanged at /auth/login/2fa. Documenting only the
 * token shape would tell a client the response always carries `accessToken`,
 * which is exactly the sort of half-truth an unannotated contract produces.
 */
export class TwoFactorChallengeDto {
  @ApiProperty({ description: 'Present the code for this challenge at POST /auth/login/2fa.' })
  challengeToken!: string;

  @ApiProperty({ example: true })
  twoFactorRequired!: boolean;
}

/** GET /auth/me — the principal plus what it is allowed to do. */
export class MeResponseDto {
  @ApiProperty({ type: UserViewDto })
  user!: UserViewDto;

  @ApiProperty({
    type: [String],
    description: 'Effective permissions, derived from the DATABASE role rather than the token.',
  })
  permissions!: string[];

  @ApiProperty({ description: 'Whether THIS session has satisfied 2FA.' })
  mfaSatisfied!: boolean;

  @ApiProperty({ description: 'Whether 2FA is mandatory for this account.' })
  twoFactorRequired!: boolean;
}

/** POST /auth/accept-invitation. */
export class AcceptInvitationResponseDto {
  @ApiProperty({ example: true })
  accepted!: boolean;

  @ApiProperty({ description: 'Taken from the invitation, never from the request body.' })
  email!: string;
}
