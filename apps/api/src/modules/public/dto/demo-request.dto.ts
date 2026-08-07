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

/** Public "Book a Demo" / contact-sales payload (POST /api/public/demo-request). */
export class DemoRequestDto {
  @ApiProperty({ minLength: 2, maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  company?: string;

  @ApiProperty({ format: 'email', maxLength: 160 })
  @IsEmail()
  @MaxLength(160)
  email!: string;

  @ApiPropertyOptional({ maxLength: 40, description: 'Free-form; no format check.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 1000000, description: 'Fleet size they expect.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  screens?: number;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  message?: string;

  @ApiPropertyOptional({ enum: ['en', 'ar'] })
  @IsOptional()
  @IsIn(['en', 'ar'])
  locale?: 'en' | 'ar';

  /** Captcha-ready placeholder. */
  @ApiPropertyOptional({
    description:
      'ACCEPTED AND IGNORED. Nothing in the codebase reads this field — it is a placeholder for ' +
      'a captcha that is not wired up, so sending a token buys no bot protection and omitting ' +
      'one costs nothing. Documented rather than hidden, because a field named captchaToken ' +
      'otherwise implies a verification step that does not happen. Rate limiting (5/hour per IP) ' +
      'is the actual protection on this route.',
    maxLength: 4000,
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  captchaToken?: string;
}
