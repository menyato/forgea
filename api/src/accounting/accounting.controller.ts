import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type {
  AccountingSettingsView,
  AccountView,
  AgedReceivables,
  BalanceSheet,
  InvoiceCounts,
  InvoiceListItem,
  JournalEntryView,
  Page,
  ProfitAndLoss,
} from '@forgea/types';
import {
  EntryListQuery,
  InvoiceListQuery,
  ManualEntryDto,
  RecordPaymentDto,
  ReportPeriodQuery,
  SaveAccountDto,
  UpdateAccountingSettingsDto,
} from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import type { AuthenticatedUser } from '../authorization/authenticated-user.js';
import { CurrentUser, RequirePermission } from '../authorization/decorators.js';
import { Books } from './books.service.js';
import { Invoicing } from './invoicing.service.js';

const today = () => new Date(new Date().toISOString().slice(0, 10));
const yearStart = () => new Date(`${new Date().getUTCFullYear()}-01-01`);

/**
 * Accounting. Staff invoice orders and record payments (they collect the money); the books —
 * accounts, settings, manual entries and reports — are for admins. Everything is audit-logged.
 */
@Controller('accounting')
export class AccountingController {
  constructor(
    private readonly invoicing: Invoicing,
    private readonly books: Books,
  ) {}

  @RequirePermission('invoices.view')
  @Get('invoices')
  invoices(@Query() query: InvoiceListQuery): Promise<Page<InvoiceListItem>> {
    return this.invoicing.list(query);
  }

  @RequirePermission('invoices.view')
  @Get('invoices/counts')
  invoiceCounts(): Promise<InvoiceCounts> {
    return this.invoicing.counts();
  }

  @RequirePermission('invoices.view')
  @Get('invoices/:id')
  invoice(@Param('id', ParseUUIDPipe) id: string): Promise<InvoiceListItem> {
    return this.invoicing.one(id);
  }

  @RequirePermission('invoices.view')
  @Get('orders/:orderId/invoices')
  forOrder(
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<InvoiceListItem[]> {
    return this.invoicing.forOrder(orderId);
  }

  @RequirePermission('invoices.create')
  @Audit({
    action: 'invoice.deposit',
    targetType: 'Order',
    targetParam: 'orderId',
  })
  @Post('orders/:orderId/deposit-invoice')
  depositInvoice(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<InvoiceListItem> {
    return this.invoicing.depositInvoice(orderId, user.id);
  }

  @RequirePermission('invoices.create')
  @Audit({
    action: 'invoice.final',
    targetType: 'Order',
    targetParam: 'orderId',
  })
  @Post('orders/:orderId/final-invoice')
  finalInvoice(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<InvoiceListItem> {
    return this.invoicing.finalInvoice(orderId, user.id);
  }

  @RequirePermission('payments.record')
  @Audit({ action: 'payment.record', targetType: 'Invoice', resultKey: 'id' })
  @Post('payments')
  recordPayment(
    @Body() dto: RecordPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<InvoiceListItem> {
    return this.invoicing.recordPayment(dto, user.id);
  }

  @RequirePermission('books.manage')
  @Audit({ action: 'invoice.credit-note', targetType: 'Invoice' })
  @Post('invoices/:id/credit-note')
  creditNote(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<InvoiceListItem> {
    return this.invoicing.creditNote(id, user.id);
  }

  @RequirePermission('books.view')
  @Get('entries')
  entries(@Query() query: EntryListQuery): Promise<Page<JournalEntryView>> {
    return this.books.entries(query);
  }

  @RequirePermission('books.view')
  @Get('entries/:id')
  entry(@Param('id', ParseUUIDPipe) id: string): Promise<JournalEntryView> {
    return this.books.entry(id);
  }

  @RequirePermission('books.manage')
  @Audit({ action: 'entry.manual', targetType: 'JournalEntry' })
  @Post('entries')
  manualEntry(
    @Body() dto: ManualEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<JournalEntryView> {
    return this.books.manualEntry(dto, user.id);
  }

  @RequirePermission('books.view')
  @Get('accounts')
  accounts(): Promise<AccountView[]> {
    return this.books.accounts();
  }

  @RequirePermission('books.manage')
  @Audit({ action: 'account.create', targetType: 'Account', targetId: 'new' })
  @Post('accounts')
  createAccount(@Body() dto: SaveAccountDto): Promise<AccountView[]> {
    return this.books.saveAccount(null, dto);
  }

  @RequirePermission('books.manage')
  @Audit({ action: 'account.update', targetType: 'Account' })
  @Put('accounts/:id')
  updateAccount(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveAccountDto,
  ): Promise<AccountView[]> {
    return this.books.saveAccount(id, dto);
  }

  @RequirePermission('books.view')
  @Get('settings')
  settings(): Promise<AccountingSettingsView> {
    return this.books.settings();
  }

  @RequirePermission('books.manage')
  @Audit({
    action: 'accounting.settings',
    targetType: 'AccountingSettings',
    targetId: 'books',
  })
  @Put('settings')
  updateSettings(
    @Body() dto: UpdateAccountingSettingsDto,
  ): Promise<AccountingSettingsView> {
    return this.books.updateSettings(dto);
  }

  @RequirePermission('books.view')
  @HttpCode(200)
  @Get('reports/profit-and-loss')
  profitAndLoss(@Query() q: ReportPeriodQuery): Promise<ProfitAndLoss> {
    return this.books.profitAndLoss(
      q.from ? new Date(q.from) : yearStart(),
      q.to ? new Date(q.to) : today(),
    );
  }

  @RequirePermission('books.view')
  @Get('reports/balance-sheet')
  balanceSheet(@Query() q: ReportPeriodQuery): Promise<BalanceSheet> {
    return this.books.balanceSheet(q.to ? new Date(q.to) : today());
  }

  @RequirePermission('books.view')
  @Get('reports/aged-receivables')
  agedReceivables(@Query() q: ReportPeriodQuery): Promise<AgedReceivables> {
    return this.books.agedReceivables(q.to ? new Date(q.to) : today());
  }
}
