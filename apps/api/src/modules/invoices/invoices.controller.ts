import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { ApiPaginatedResponse } from '../../common/dto/api-response.dto';
import { InvoiceDto } from '../plans/dto/billing-response.dto';
import { CreateInvoiceDto, ListInvoicesQueryDto, UpdateInvoiceStatusDto } from './dto/invoice.dto';
import { InvoicesService } from './invoices.service';

@ApiTags('invoices')
@ApiBearerAuth()
@Roles(UserRole.SUPER_ADMIN)
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a manual invoice (Super Admin).' })
  @ApiCreatedResponse({ type: InvoiceDto })
  create(@Body() dto: CreateInvoiceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invoices.create(user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List invoices.' })
  @ApiPaginatedResponse(InvoiceDto)
  list(@Query() query: ListInvoicesQueryDto) {
    return this.invoices.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an invoice by id.' })
  @ApiOkResponse({ type: InvoiceDto })
  get(@Param('id') id: string) {
    return this.invoices.getByIdOrThrow(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update invoice status (Draft/Unpaid/Paid/Overdue/Cancelled).' })
  @ApiOkResponse({ type: InvoiceDto })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoices.updateStatus(user, id, dto.status);
  }
}
