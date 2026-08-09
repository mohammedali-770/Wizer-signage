import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

const UPDATE_STATES = ['DOWNLOADED', 'INSTALLING', 'INSTALLED', 'FAILED', 'BLOCKED'] as const;

export class AndroidUpdateResultDto {
  @ApiProperty({ enum: UPDATE_STATES })
  @IsIn(UPDATE_STATES)
  state!: (typeof UPDATE_STATES)[number];

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Exact OTA policy revision that authorized this attempt.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  policyRevision?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  targetVersionCode?: number;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  installedVersionCode?: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  error?: string;
}
