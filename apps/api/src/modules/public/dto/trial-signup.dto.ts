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
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  companyName!: string;

  @IsEmail()
  @MaxLength(160)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  businessType?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  branches?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  screens?: number;

  @IsOptional()
  @IsIn(['en', 'ar'])
  preferredLanguage?: 'en' | 'ar';

  @IsString()
  @MinLength(10)
  @MaxLength(200)
  password!: string;

  /** Captcha-ready placeholder (e.g. reCAPTCHA/Turnstile token). Verified when
   *  a provider is configured; accepted but unused otherwise. */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  captchaToken?: string;
}
