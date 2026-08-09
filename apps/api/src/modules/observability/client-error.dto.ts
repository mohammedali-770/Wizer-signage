import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const CLIENT_ERROR_KINDS = ['WINDOW_ERROR', 'UNHANDLED_REJECTION'] as const;

export class ClientErrorDto {
  @IsIn(CLIENT_ERROR_KINDS)
  kind!: (typeof CLIENT_ERROR_KINDS)[number];

  @Matches(/^[a-f0-9]{24}$/)
  fingerprint!: string;

  @IsString()
  @MaxLength(160)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  source?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  line?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  column?: number;
}
