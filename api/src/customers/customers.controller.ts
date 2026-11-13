import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type {
  CustomerDetail,
  CustomerList,
  CustomerSummary,
} from '@forgea/types';
import {
  CustomerDetailsDto,
  CustomerEmailQuery,
  CustomerListQuery,
  MergeCustomersDto,
} from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import { AdminOnly, RequirePermission } from '../authorization/decorators.js';
import {
  CustomerMergeService,
  type CustomerMergeResult,
} from './customer-merge.service.js';
import { CustomersService } from './customers.service.js';

/** The dashboard's Customers: people with or without an account, and what they did. */
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly merges: CustomerMergeService,
  ) {}

  @RequirePermission('customers.view')
  @Get()
  list(@Query() query: CustomerListQuery): Promise<CustomerList> {
    return this.customers.list(query);
  }

  /** The Overview's numbers: accounts, new this week, seen this week, without an account. */
  @RequirePermission('customers.view')
  @Get('summary')
  summary(): Promise<CustomerSummary> {
    return this.customers.summary();
  }

  /** One customer, by email address (people without an account have nothing else). */
  @RequirePermission('customers.view')
  @Get('one')
  detail(@Query() query: CustomerEmailQuery): Promise<CustomerDetail> {
    return this.customers.detail(query.email);
  }

  /** A customer account's name and phone (admin only). */
  @AdminOnly()
  @Audit({ action: 'customer.details', targetType: 'User' })
  @HttpCode(204)
  @Put('details')
  details(@Body() dto: CustomerDetailsDto): Promise<void> {
    return this.merges.details(dto.email, dto.name, dto.phone);
  }

  /** One customer into another (admin only): the first account is removed. */
  @AdminOnly()
  @Audit({ action: 'customer.merge', targetType: 'User', resultKey: 'into' })
  @HttpCode(200)
  @Post('merge')
  merge(@Body() dto: MergeCustomersDto): Promise<CustomerMergeResult> {
    return this.merges.merge(dto.from, dto.into);
  }
}
