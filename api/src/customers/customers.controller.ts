import { Controller, Get, Query } from '@nestjs/common';
import type { CustomerDetail, CustomerList } from '@forgea/types';
import { CustomerEmailQuery, CustomerListQuery } from '@forgea/validation';
import { RequirePermission } from '../authorization/decorators.js';
import { CustomersService } from './customers.service.js';

/** The dashboard's Customers: people with or without an account, and what they did. */
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @RequirePermission('customers.view')
  @Get()
  list(@Query() query: CustomerListQuery): Promise<CustomerList> {
    return this.customers.list(query);
  }

  /** One customer, by email address (people without an account have nothing else). */
  @RequirePermission('customers.view')
  @Get('one')
  detail(@Query() query: CustomerEmailQuery): Promise<CustomerDetail> {
    return this.customers.detail(query.email);
  }
}
