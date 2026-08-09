import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { ClientErrorDto } from './client-error.dto';
import { ClientErrorService } from './client-error.service';

@ApiExcludeController()
@ApiBearerAuth()
@Controller('client-telemetry')
export class ClientErrorController {
  constructor(private readonly errors: ClientErrorService) {}

  @Post('error')
  @HttpCode(202)
  record(@CurrentUser() user: AuthenticatedUser, @Body() dto: ClientErrorDto) {
    return this.errors.record(user, dto);
  }
}
