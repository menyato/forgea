import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuditLogModule } from './audit-log/audit-log.module.js';
import { AuditInterceptor } from './audit-log/audit.interceptor.js';
import { AuthModule } from './auth/auth.module.js';
import { AuthorizationModule } from './authorization/authorization.module.js';
import { JwtAuthGuard } from './authorization/jwt-auth.guard.js';
import { PermissionsGuard } from './authorization/permissions.guard.js';
import { CartModule } from './cart/cart.module.js';
import { validateEnvironment } from './config/environment.js';
import { HealthModule } from './health/health.module.js';
import { LeadsModule } from './leads/leads.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { PricingErrorFilter } from './pricing/pricing-error.filter.js';
import { PrismaErrorFilter } from './common/prisma-error.filter.js';
import { PricingModule } from './pricing/pricing.module.js';
import { PrintJobsModule } from './print-jobs/print-jobs.module.js';
import { ProductsModule } from './products/products.module.js';
import { ClientIpMiddleware } from './security/client-ip.js';
import { CsrfGuard } from './security/csrf.guard.js';
import { SecurityModule } from './security/security.module.js';
import { ClientIpThrottlerGuard } from './security/throttle-policies.js';
import { UploadsModule } from './uploads/uploads.module.js';
import { UsersModule } from './users/users.module.js';
import { CurrenciesModule } from './currencies/currencies.module.js';
import { StoreSettingsModule } from './store-settings/store-settings.module.js';
import { CategoriesModule } from './categories/categories.module.js';
import { MaterialsModule } from './materials/materials.module.js';
import { ProductOptionsModule } from './product-options/product-options.module.js';
import { SiteThemeModule } from './site-theme/site-theme.module.js';
import { CustomRequestsModule } from './custom-requests/custom-requests.module.js';
import { CatalogTransferModule } from './catalog-transfer/catalog-transfer.module.js';
import { MailModule } from './mail/mail.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { RelatedModule } from './related/related.module.js';
import { QuotationsModule } from './quotations/quotations.module.js';
import { AccountingModule } from './accounting/accounting.module.js';
import { StockModule } from './stock/stock.module.js';
import { TextStudioModule } from './text-studio/text-studio.module.js';
import { InsightsModule } from './insights/insights.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    SecurityModule,
    AuthorizationModule,
    AuditLogModule,
    HealthModule,
    UsersModule,
    AuthModule,
    ProductsModule,
    CartModule,
    OrdersModule,
    PrintJobsModule,
    LeadsModule,
    UploadsModule,
    PricingModule,
    CurrenciesModule,
    StoreSettingsModule,
    CategoriesModule,
    MaterialsModule,
    ProductOptionsModule,
    SiteThemeModule,
    CustomRequestsModule,
    CatalogTransferModule,
    MailModule,
    QuotationsModule,
    RelatedModule,
    CustomersModule,
    AccountingModule,
    StockModule,
    TextStudioModule,
    InsightsModule,
  ],
  providers: [
    // Global guards run in this order: rate limit → CSRF → who are you → may you.
    { provide: APP_GUARD, useClass: ClientIpThrottlerGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_FILTER, useClass: PricingErrorFilter },
    { provide: APP_FILTER, useClass: PrismaErrorFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ClientIpMiddleware).forRoutes('*path');
  }
}
