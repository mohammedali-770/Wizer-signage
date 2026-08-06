import { ApiProperty } from '@nestjs/swagger';

/**
 * Health-probe responses.
 *
 * These already carried `@ApiResponse({ status: 200, description })`, which
 * documents that a 200 happens and says nothing about its body — so a
 * generated client got `unknown` and the routes still counted as unannotated.
 * A description is not a schema.
 */

/** GET /health — liveness. Never touches the database. */
export class HealthStatusDto {
  @ApiProperty({
    enum: ['ok'],
    description: 'Always `ok`; the process answering at all IS the check.',
  })
  status!: string;

  @ApiProperty({ example: 'wizer-signage-api' })
  service!: string;

  @ApiProperty({ description: 'The API version, read from package.json at startup.' })
  version!: string;

  @ApiProperty({ description: 'Process uptime in seconds, fractional.', example: 1234.56 })
  uptime!: number;

  @ApiProperty({ format: 'date-time' })
  timestamp!: string;
}

/** The individual readiness checks. */
export class ReadinessChecksDto {
  @ApiProperty({ enum: ['up', 'down'], description: 'A lightweight `SELECT 1`.' })
  database!: string;

  @ApiProperty({ description: 'An object-storage driver is configured.' })
  storageConfigured!: boolean;

  @ApiProperty({ description: 'An SMTP transport is configured; otherwise mail is log-only.' })
  mailConfigured!: boolean;
}

/**
 * GET /health/ready — readiness.
 *
 * Returned with 200 only when `status` is `ok`. A `degraded` result is thrown
 * as a 503 with this same body, so a load balancer stops routing — which means
 * a client that sees this shape under 200 will never find `degraded` in it,
 * and one reading the 503 body will.
 */
export class ReadinessStatusDto {
  @ApiProperty({
    enum: ['ok', 'degraded'],
    description: 'Under a 200 this is always `ok`; `degraded` arrives with a 503.',
  })
  status!: string;

  @ApiProperty({ example: 'wizer-signage-api' })
  service!: string;

  @ApiProperty({ type: ReadinessChecksDto })
  checks!: ReadinessChecksDto;

  @ApiProperty({ format: 'date-time' })
  timestamp!: string;
}
