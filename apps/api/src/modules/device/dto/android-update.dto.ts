import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

const UPDATE_STATES = ['DOWNLOADED', 'INSTALLING', 'INSTALLED', 'FAILED', 'BLOCKED'] as const;

export class AndroidUpdateResultDto {
  @IsIn(UPDATE_STATES)
  state!: (typeof UPDATE_STATES)[number];

  @IsOptional()
  @IsInt()
  @Min(1)
  targetVersionCode?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  installedVersionCode?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  error?: string;
}
