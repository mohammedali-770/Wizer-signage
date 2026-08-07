import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Public self-service trial signup payload (POST /api/public/trial-signup).
 * `confirmPassword` is validated client-side only; the server receives the
 * final password. The global ValidationPipe (whitelist + forbidNonWhitelisted)
 * strips/rejects anything not listed here, so all input is sanitized by schema.
 */
export class TrialSignupDto {
  @ApiProperty({ minLength: 2, maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  @ApiProperty({
    minLength: 2,
    maxLength: 120,
    description:
      'The tenant slug is derived from this; the allocated slug may differ if it collides.',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  companyName!: string;

  @ApiProperty({ format: 'email', maxLength: 160, description: 'Becomes the owner account.' })
  @IsEmail()
  @MaxLength(160)
  email!: string;

  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  country?: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional({ maxLength: 80, description: 'Free-form, not an enum.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  businessType?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  branches?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 1000000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  screens?: number;

  @ApiPropertyOptional({ enum: ['en', 'ar'] })
  @IsOptional()
  @IsIn(['en', 'ar'])
  preferredLanguage?: 'en' | 'ar';

  @ApiProperty({
    description:
      'The owner account password. `PasswordService.evaluate()` runs on it in public.service.ts, ' +
      'so the full policy applies — upper, lower, digit, symbol, and no common/breached ' +
      'password — not merely the 10-character minimum this validator states.',
    minLength: 10,
    maxLength: 200,
  })
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  password!: string;

  /** Captcha-ready placeholder (e.g. reCAPTCHA/Turnstile token). Verified when
   *  a provider is configured; accepted but unused otherwise. */
  @ApiPropertyOptional({
    description:
      'ACCEPTED AND IGNORED — no provider is wired up and nothing in the codebase reads this ' +
      'field, so a token buys no bot protection. The actual protection on this route is the ' +
      'rate limit (5/hour per IP).',
    maxLength: 4000,
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  captchaToken?: string;
}
