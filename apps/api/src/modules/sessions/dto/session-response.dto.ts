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
 * `{ revoked: n }` — how many sessions were ended.
 *
 * The field name collides with `RevokedFlagDto.revoked`, which is a BOOLEAN on
 * `DELETE /sessions/{id}`. Same key, two types, on sibling routes of the same
 * controller. A client that reads `res.revoked` and branches on truthiness
 * happens to work; one that displays it, or compares it to a number, does not.
 * Documented as two classes so the contract shows the collision instead of
 * averaging it away.
 */
export class RevokedCountDto {
  @ApiProperty({ example: 3, description: 'Number of sessions revoked.' })
  revoked!: number;
}

/** `{ revoked: true }` — DELETE /sessions/{id}. See the note above. */
export class RevokedFlagDto {
  @ApiProperty({ example: true, description: 'Always true. NOT a count, despite the name.' })
  revoked!: boolean;
}
