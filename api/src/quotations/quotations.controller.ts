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
import { Throttle } from '@nestjs/throttler';
import type {
  CheckoutResult,
  Page,
  QuotationContact,
  QuotationDetail,
  QuotationListItem,
  QuotationPrintFileView,
} from '@forgea/types';
import {
  AddNoteDto,
  CustomerEmailQuery,
  AcceptQuotationDto,
  DeclineQuotationDto,
  QuotationListQuery,
  QuotationPrintFileDto,
  SaveQuotationDto,
} from '@forgea/validation';
import type { QuotationStatus } from '../generated/prisma/enums.js';
import { Audit } from '../audit-log/audit.interceptor.js';
import type { AuthenticatedUser } from '../authorization/authenticated-user.js';
import {
  CurrentUser,
  Public,
  RequirePermission,
} from '../authorization/decorators.js';
import { ParsePatternPipe } from '../custom-requests/parse-pattern.pipe.js';
import { THROTTLE } from '../security/throttle-policies.js';
import { QuotationPrintFiles } from './quotation-print-files.js';
import { QuotationsService } from './quotations.service.js';

const QuotationNumber = () =>
  Param(
    'number',
    new ParsePatternPipe(/^Q-\d{4}-\d{4,}$/, 'Quotation not found'),
  );

/** A signed link token: three base64url parts, of a sane length. */
const LinkToken = new ParsePatternPipe(
  /^[\w-]{10,200}\.[\w-]{10,1000}\.[\w-]{10,200}$/,
  'This link is not valid any more. Ask the studio to send the quotation again.',
);

/** Staff write and confirm quotations; the customer sees and accepts their own online. */
@Controller('quotations')
export class QuotationsController {
  constructor(
    private readonly quotations: QuotationsService,
    private readonly printFiles: QuotationPrintFiles,
  ) {}

  @Get('mine/:number')
  mine(
    @QuotationNumber() number: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuotationDetail> {
    return this.quotations.mine(user.id, number);
  }

  @Throttle(THROTTLE.checkout)
  @HttpCode(200)
  @Post('mine/:number/accept')
  accept(
    @QuotationNumber() number: string,
    @Body() dto: AcceptQuotationDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CheckoutResult> {
    return this.quotations.accept(user.id, number, dto.seen);
  }

  /** The customer says no, from their account (a reason is optional). */
  @Throttle(THROTTLE.checkout)
  @HttpCode(200)
  @Post('mine/:number/decline')
  declineMine(
    @QuotationNumber() number: string,
    @Body() dto: DeclineQuotationDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuotationDetail> {
    return this.quotations.declineMine(user.id, number, dto.reason ?? null);
  }

  /** Public: the link in the quotation email opens it without an account. */
  @Public()
  @Throttle(THROTTLE.quote)
  @Get('link/:token')
  byLink(@Param('token', LinkToken) token: string): Promise<QuotationDetail> {
    return this.quotations.byLink(token);
  }

  /** Accepting from the email: signed in with the address it was sent to. */
  @Throttle(THROTTLE.checkout)
  @HttpCode(200)
  @Post('link/:token/accept')
  acceptByLink(
    @Param('token', LinkToken) token: string,
    @Body() dto: AcceptQuotationDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CheckoutResult> {
    return this.quotations.acceptByLink(token, user.id, dto.seen);
  }

  /** Public, like the link itself: saying no commits the customer to nothing. */
  @Public()
  @Throttle(THROTTLE.checkout)
  @HttpCode(200)
  @Post('link/:token/decline')
  declineByLink(
    @Param('token', LinkToken) token: string,
    @Body() dto: DeclineQuotationDto,
  ): Promise<QuotationDetail> {
    return this.quotations.declineByLink(token, dto.reason ?? null);
  }

  @RequirePermission('quotations.view')
  @Get()
  list(@Query() query: QuotationListQuery): Promise<Page<QuotationListItem>> {
    return this.quotations.list(query);
  }

  /** How many in each status, for the dashboard's tabs. */
  @RequirePermission('quotations.view')
  @Get('counts')
  counts(): Promise<Partial<Record<QuotationStatus, number>>> {
    return this.quotations.counts();
  }

  /** A 3MF for a line: what one piece takes (from the file itself) and its shop price. */
  @RequirePermission('quotations.manage')
  @HttpCode(200)
  @Post('print-file')
  printFile(
    @Body() dto: QuotationPrintFileDto,
  ): Promise<QuotationPrintFileView> {
    return this.printFiles.read(dto.key, dto.materialId);
  }

  /** Name, phone and address from their account, last order, quotation or lead. */
  @RequirePermission('quotations.manage')
  @Get('contact')
  contact(@Query() query: CustomerEmailQuery): Promise<QuotationContact> {
    return this.quotations.contact(query.email);
  }

  @RequirePermission('quotations.view')
  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<QuotationDetail> {
    return this.quotations.detail(id);
  }

  @RequirePermission('quotations.manage')
  @Audit({ action: 'quotation.create', targetType: 'Quotation' })
  @Post()
  create(
    @Body() dto: SaveQuotationDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuotationDetail> {
    return this.quotations.create(dto, user.id);
  }

  @RequirePermission('quotations.manage')
  @Audit({ action: 'quotation.update', targetType: 'Quotation' })
  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveQuotationDto,
  ): Promise<QuotationDetail> {
    return this.quotations.update(id, dto);
  }

  @RequirePermission('quotations.manage')
  @Audit({ action: 'quotation.send', targetType: 'Quotation' })
  @HttpCode(200)
  @Post(':id/send')
  send(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuotationDetail> {
    return this.quotations.send(id, user.id);
  }

  @RequirePermission('quotations.manage')
  @Audit({ action: 'quotation.confirm', targetType: 'Quotation' })
  @HttpCode(200)
  @Post(':id/confirm')
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CheckoutResult> {
    return this.quotations.confirm(id, user.id);
  }

  @RequirePermission('quotations.manage')
  @Audit({ action: 'quotation.cancel', targetType: 'Quotation' })
  @HttpCode(200)
  @Post(':id/cancel')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuotationDetail> {
    return this.quotations.cancel(id, user.id, dto.body);
  }
}
