import { ApiProperty } from '@nestjs/swagger';

/**
 * Two-factor response shapes for the OpenAPI contract.
 *
 * Two of these return material that is readable exactly once, and the
 * descriptions say so rather than leaving a client to guess it can re-fetch.
 */

/** GET /auth/2fa/status. Both flags come from the TOKEN, not a fresh DB read. */
export class TwoFactorStatusDto {
  @ApiProperty({ description: 'Whether 2FA is mandatory for this account.' })
  required!: boolean;

  @ApiProperty({ description: 'Whether THIS session has satisfied 2FA.' })
  satisfied!: boolean;
}

/**
 * POST /auth/2fa/setup — the enrollment payload.
 *
 * `secret` is the TOTP secret in PLAINTEXT. It has to be: the user is enrolling
 * an authenticator app and either scans the QR or types the secret in. It is
 * stored encrypted at rest and is never returned again after enrollment
 * completes.
 *
 * It is, nonetheless, the credential. Anyone who can read this response can
 * generate valid codes for the account from then on. Worth stating plainly in
 * published documentation, because "the setup endpoint returns a secret" is
 * easy to skim past when reviewing what an endpoint is allowed to expose.
 */
export class TwoFactorSetupDto {
  @ApiProperty({
    description:
      'Base32 TOTP secret, in plaintext, for manual entry. A credential: anyone holding it can ' +
      'generate valid codes. Returned only during enrollment and never readable afterwards.',
  })
  secret!: string;

  @ApiProperty({
    description: 'otpauth:// URI. Contains the same secret — treat it with the same care.',
    example: 'otpauth://totp/Wizer:user@example.com?secret=...&issuer=Wizer',
  })
  otpauthUrl!: string;

  @ApiProperty({
    description: 'The otpauth URI rendered as a QR code, inline as a data: URL. Same secret again.',
  })
  qrCodeDataUrl!: string;
}

/**
 * POST /auth/2fa/enable — the backup codes.
 *
 * Returned ONCE. Only hashes are stored, so there is no endpoint that can show
 * them again; a user who does not save them here has to re-enroll.
 */
export class TwoFactorBackupCodesDto {
  @ApiProperty({
    type: [String],
    description:
      'Single-use recovery codes, shown once and never retrievable. Each is consumed on use.',
  })
  backupCodes!: string[];
}

/**
 * `{ disabled: true }` — POST /auth/2fa/disable.
 *
 * The eighth spelling of "done" across the API. Catalogued in
 * `common/dto/api-response.dto.ts`; it lives here because nothing else returns
 * it.
 */
export class DisabledResponseDto {
  @ApiProperty({ example: true })
  disabled!: boolean;
}
