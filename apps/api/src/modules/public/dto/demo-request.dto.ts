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
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  company?: string;

  @IsEmail()
  @MaxLength(160)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  screens?: number;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  message?: string;

  @IsOptional()
  @IsIn(['en', 'ar'])
  locale?: 'en' | 'ar';

  /** Captcha-ready placeholder. */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  captchaToken?: string;
}
