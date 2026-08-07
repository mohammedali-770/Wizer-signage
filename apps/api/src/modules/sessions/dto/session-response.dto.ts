import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Session response shapes for the OpenAPI contract.
 *
 * `SessionsService.toView` is
 * `const { refreshTokenHash, previousRefreshTokenHash, ...view } = session` —
 * a SPREAD view, like invitations. A new column on the Session table becomes
 * part of this response immediately, with nothing in the code saying so, so the
 * field list below is the only record of what the endpoint is supposed to
 * return and it is pinned by an exact match rather than a not-contains.
 *
 * Two hashes are removed and both must stay removed: `refreshTokenHash` is the
 * live credential for the session, and `previousRefreshTokenHash` is the one
 * still accepted inside the rotation grace window — publishing either would
 * hand a reader something a client can replay.
 */
export class SessionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiPropertyOptional({ nullable: true })
  companyId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Set only on a Super Admin impersonation session. The real human at the keyboard; ' +
      '`userId` is the impersonated principal.',
  })
  impersonatorId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'The reason given when impersonating.' })
  impersonationNote?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    format: 'date-time',
    description: 'When the refresh token was last rotated. Bounds the grace window.',
  })
  refreshRotatedAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  userAgent?: string | null;

  @ApiPropertyOptional({ nullable: true })
  ip?: string | null;

  @ApiProperty({ description: 'Whether THIS session has satisfied 2FA.' })
  mfaSatisfied!: boolean;

  @ApiProperty({ format: 'date-time' })
  lastActiveAt!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  @ApiPropertyOptional({
    nullable: true,
    format: 'date-time',
    description: 'Always null here — the endpoint only returns sessions that are still live.',
  })
  revokedAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  revokedReason?: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({
    description:
      'True for the session making the request — added by the view, not a column. This is how ' +
      'a client knows which row NOT to offer a sign-out button for.',
  })
  current!: boolean;
}

/**
 * `{ revokedCount: n }` — how many sessions were ended.
 *
 * The field was called `revoked`, colliding with `RevokedFlagDto.revoked` — a
 * BOOLEAN on `DELETE /sessions/{id}`, a sibling route of the same controller.
 * Same key, two types: a client reading `res.revoked` and branching on
 * truthiness happened to work, while one displaying it or comparing it to a
 * number did not, and nothing told it which route it was on.
 *
 * BREAKING, deliberately and loudly: a client still reading `revoked` here now
 * gets `undefined` immediately, rather than silently truthy-testing a count.
 * The name now means one thing across both routes.
 */
export class RevokedCountDto {
  @ApiProperty({ example: 3, description: 'Number of sessions revoked. Renamed from `revoked`.' })
  revokedCount!: number;
}

/** `{ revoked: true }` — DELETE /sessions/{id}. A boolean, and now unambiguous. */
export class RevokedFlagDto {
  @ApiProperty({ example: true, description: 'Always true. The bulk routes return revokedCount.' })
  revoked!: boolean;
}
