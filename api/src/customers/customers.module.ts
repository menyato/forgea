import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { CustomersController } from './customers.controller.js';
import { CustomerMergeService } from './customer-merge.service.js';
import { CustomersService } from './customers.service.js';

/** Customers by email: accounts, and people known only by their address. */
@Module({
  imports: [DatabaseModule],
  controllers: [CustomersController],
  providers: [CustomersService, CustomerMergeService],
})
export class CustomersModule {}
