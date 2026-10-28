import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module.js';
import { CurrenciesModule } from '../currencies/currencies.module.js';
import { AccountingModule } from '../accounting/accounting.module.js';
import { MailModule } from '../mail/mail.module.js';
import { StoreSettingsModule } from '../store-settings/store-settings.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { UsersModule } from '../users/users.module.js';
import { CheckoutService } from './checkout.service.js';
import { CustomerOrdersService } from './customer-orders.service.js';
import { OrderStatusService } from './order-status.service.js';
import { OrdersController } from './orders.controller.js';
import { OrdersRepository } from './orders.repository.js';
import { OrdersService } from './orders.service.js';

@Module({
  imports: [
    DatabaseModule,
    CartModule,
    PricingModule,
    CurrenciesModule,
    UsersModule,
    MailModule,
    StoreSettingsModule,
    AccountingModule,
  ],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    OrdersRepository,
    CheckoutService,
    CustomerOrdersService,
    OrderStatusService,
  ],
  // Custom requests place an order when their quote is accepted.
  exports: [CheckoutService],
})
export class OrdersModule {}
