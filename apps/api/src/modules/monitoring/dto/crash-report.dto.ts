import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

/**
 * Privacy-bounded previous-run crash report from the Android player. The raw
 * exception/stack trace stays on the TV and is never accepted by this DTO.
 */
export class DeviceCrashReportDto {
  @IsInt()
  @Min(0)
  crashedAtMillis!: number;

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
