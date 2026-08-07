import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InvoiceStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class InvoiceLineItemDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  description!: string;

  @ApiProperty({ minimum: 1, description: 'Whole units only.' })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({
    minimum: 0,
    description:
      'Two decimal places. Sent as a NUMBER; invoice money comes BACK as a string, because ' +
      'responses carry the raw Prisma Decimal.',
    example: 49.9,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitPrice!: number;
}

/**
 * There is no payment gateway in v1 (an explicit non-goal), so an invoice here
 * is a RECORD of what is owed — creating one charges nobody.
 */
export class CreateInvoiceDto {
  @ApiProperty({
    description: 'The tenant billed. A Super Admin route, so it is named in the body.',
  })
  @IsString()
  companyId!: string;

  @ApiPropertyOptional({
    description: 'Links the invoice to a subscription, if it belongs to one.',
  })
  @IsOptional()
  @IsString()
  subscriptionId?: string;

  @ApiPropertyOptional({ minLength: 3, maxLength: 3, example: 'USD' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiProperty({
    type: [InvoiceLineItemDto],
    minItems: 1,
    maxItems: 100,
    description:
      'At least one line — an empty invoice is refused. Totals are computed server-side.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineItemDto)
  lineItems!: InvoiceLineItemDto[];

  @ApiPropertyOptional({
    minimum: 0,
    description: 'An absolute AMOUNT, not a percentage or rate.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  tax?: number;

  @ApiPropertyOptional({ enum: Object.values(InvoiceStatus) })
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  issuedAt?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  dueAt?: string;
}

export class UpdateInvoiceStatusDto {
  @ApiProperty({
    enum: Object.values(InvoiceStatus),
    description:
      'Status is the ONLY mutable field — line items and amounts cannot be edited after issue, ' +
      'and financial records are never deleted by the retention sweep.',
  })
  @IsEnum(InvoiceStatus)
  status!: InvoiceStatus;
}

export class ListInvoicesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @IsOptional()
  @IsString()
  companyId?: string;
}
