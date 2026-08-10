import { ApiProperty } from '@nestjs/swagger';

import { MonitoringOverviewDto } from './monitoring-response.dto';

export class MonitoringScreenPageMetaDto {
  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;

  @ApiProperty()
  totalPages!: number;
}

export class MonitoringOverviewPaginatedDto extends MonitoringOverviewDto {
  @ApiProperty({ type: MonitoringScreenPageMetaDto })
  screenMeta!: MonitoringScreenPageMetaDto;

  @ApiProperty({
    description:
      'True when more than 200 live OFFLINE/WARNING alert candidates exist; use screen pagination/export for the remainder.',
  })
  alertsTruncated!: boolean;
}
