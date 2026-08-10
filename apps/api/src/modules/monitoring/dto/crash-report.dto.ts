import { IsInt, IsOptional, IsString, Length, Matches, MaxLength, Min } from 'class-validator';

/** Raw exception/stack data is intentionally not accepted. */
export class DeviceCrashReportDto {
  @IsInt()
  @Min(0)
  crashedAtMillis!: number;

  @Length(24, 24)
  @Matches(/^[a-f0-9]{24}$/)
  fingerprint!: string;

  @IsInt()
  @Min(1)
  crashCount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  appVersion?: string;
}
