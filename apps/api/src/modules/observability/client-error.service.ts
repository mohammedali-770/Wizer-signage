import { Injectable, Logger } from '@nestjs/common';

import type { AuthenticatedUser } from '../../common/types/auth.types';
import type { ClientErrorDto } from './client-error.dto';

@Injectable()
export class ClientErrorService {
  private readonly logger = new Logger('DashboardClientError');

  record(user: AuthenticatedUser, dto: ClientErrorDto) {
    // Nest's production ConsoleLogger emits this object as JSON. Keep the shape
    // intentionally bounded and do not accept/send browser storage, cookies,
    // request payloads or stack traces through this endpoint.
    this.logger.warn({
      event: 'dashboard_client_error',
      companyId: user.companyId,
      userId: user.userId,
      kind: dto.kind,
      fingerprint: dto.fingerprint,
      message: dto.message,
      source: dto.source ?? null,
      line: dto.line ?? null,
      column: dto.column ?? null,
    });
    return { accepted: true };
  }
}
