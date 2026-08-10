import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

/** Pagination applies only to the detailed screen rows; fleet totals remain global. */
export class MonitoringOverviewQueryDto extends PaginationQueryDto {}
