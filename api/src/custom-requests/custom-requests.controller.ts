import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type {
  CheckoutResult,
  CustomRequestListItem,
  CustomRequestView,
  Page,
  RequestEstimate,
  RequestPrice,
  StaffCustomRequest,
  UploadedFile as UploadedFileView,
} from '@forgea/types';
import {
  AcceptQuoteDto,
  CloseCustomRequestDto,
  CreateCustomRequestDto,
  CursorPageQuery,
  CustomRequestListQuery,
  EstimateRequestDto,
  QuoteCustomRequestDto,
  REQUEST_NUMBER_PATTERN,
  RequestPriceDto,
} from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import type { AuthenticatedUser } from '../authorization/authenticated-user.js';
import {
  CurrentUser,
  Public,
  RequirePermission,
} from '../authorization/decorators.js';
import {
  UploadPurpose,
  type CustomRequestStatus,
} from '../generated/prisma/enums.js';
import { THROTTLE } from '../security/throttle-policies.js';
import { UPLOAD_POLICIES } from '../uploads/upload-policies.js';
import { UploadSlots } from '../uploads/upload-slots.interceptor.js';
import { CustomerFilesService } from './customer-files.service.js';
import { CustomRequestsService } from './custom-requests.service.js';
import { ParsePatternPipe } from './parse-pattern.pipe.js';

const RequestNumber = () =>
  Param(
    'number',
    new ParsePatternPipe(REQUEST_NUMBER_PATTERN, 'Request not found'),
  );

/**
 * Customers (signed in) create and answer requests under /custom-requests/mine; staff work
 * the inbox under /custom-requests/:id.
 */
@Controller('custom-requests')
export class CustomRequestsController {
  constructor(
    private readonly requests: CustomRequestsService,
    private readonly files: CustomerFilesService,
  ) {}

  /** Public: the materials a customer can ask for (the request form's choices). */
  @Public()
  @Get('materials')
  materials(): Promise<{ id: string; code: string; name: string }[]> {
    return this.requests.materials();
  }

  /** A 3D model (STL, GLB) or photo for a request, up to the owner's size limit. */
  @Throttle(THROTTLE.upload)
  @Post('files')
  @UseInterceptors(
    UploadSlots,
    FileInterceptor('file', {
      // The hard ceiling while streaming; the owner's lower limit is checked next.
      limits: {
        fileSize: UPLOAD_POLICIES[UploadPurpose.CUSTOM_REQUEST_FILE].maxBytes,
        files: 1,
        fields: 0,
      },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UploadedFileView> {
    return this.files.receive(file, user.id);
  }

  @Throttle(THROTTLE.quote)
  @HttpCode(200)
  @Post('estimate')
  estimate(
    @Body() dto: EstimateRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ estimate: RequestEstimate | null }> {
    return this.requests.estimate(dto, user.id);
  }

  @Throttle(THROTTLE.customRequest)
  @Post()
  create(
    @Body() dto: CreateCustomRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CustomRequestView> {
    return this.requests.create(dto, user.id);
  }

  @Get('mine')
  mine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CursorPageQuery,
  ): Promise<Page<CustomRequestView>> {
    return this.requests.mine(user.id, query);
  }

  @Get('mine/:number')
  mineOne(
    @RequestNumber() number: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CustomRequestView> {
    return this.requests.mineOne(user.id, number);
  }

  /** Accepting the quote places the order (delivery and payment as at checkout). */
  @Throttle(THROTTLE.checkout)
  @Post('mine/:number/accept')
  accept(
    @RequestNumber() number: string,
    @Body() dto: AcceptQuoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CheckoutResult> {
    return this.requests.accept(user.id, number, dto);
  }

  @HttpCode(200)
  @Post('mine/:number/decline')
  decline(
    @RequestNumber() number: string,
    @Body() dto: CloseCustomRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CustomRequestView> {
    return this.requests.decline(user.id, number, dto.note);
  }

  @HttpCode(200)
  @Post('mine/:number/cancel')
  cancelMine(
    @RequestNumber() number: string,
    @Body() dto: CloseCustomRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CustomRequestView> {
    return this.requests.cancelMine(user.id, number, dto.note);
  }

  /** The dashboard inbox, for staff (who quote) and designers (who design). */
  @RequirePermission('requests.view')
  @Get()
  list(
    @Query() query: CustomRequestListQuery,
  ): Promise<Page<CustomRequestListItem>> {
    return this.requests.list(query);
  }

  /** How many in each status, for the dashboard's tabs. */
  @RequirePermission('requests.view')
  @Get('counts')
  counts(): Promise<Partial<Record<CustomRequestStatus, number>>> {
    return this.requests.counts();
  }

  @RequirePermission('requests.view')
  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<StaffCustomRequest> {
    return this.requests.detail(id);
  }

  /**
   * The studio's design for the request — a 3D model or an image — shown to the customer
   * with the quote. Replaces the previous one while the request is still open. Audit-logged.
   */
  @RequirePermission('requests.design')
  @Audit({ action: 'custom-request.design', targetType: 'CustomRequest' })
  @Post(':id/design')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: UPLOAD_POLICIES[UploadPurpose.CUSTOM_REQUEST_FILE].maxBytes,
        files: 1,
        fields: 0,
      },
    }),
  )
  async design(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StaffCustomRequest> {
    const uploaded = await this.files.receiveFromStudio(file, user.id);
    return this.requests.attachDesign(id, uploaded);
  }

  /**
   * The request priced by the shop's rules from its file's figures (the studio's 3MF design,
   * else the customer's 3MF), with lines switched off and costs added. Shows the studio's cost
   * structure, so `pricing.manage` only. Changes nothing.
   */
  @RequirePermission('pricing.manage')
  @HttpCode(200)
  @Post(':id/price')
  price(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestPriceDto,
  ): Promise<RequestPrice> {
    return this.requests.price(id, dto);
  }

  /** Sends the price; the customer sees it at once. Audit-logged. */
  @RequirePermission('requests.quote')
  @Audit({ action: 'custom-request.quote', targetType: 'CustomRequest' })
  @HttpCode(200)
  @Post(':id/quote')
  quote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: QuoteCustomRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StaffCustomRequest> {
    return this.requests.quote(id, dto, user.id);
  }

  @RequirePermission('requests.quote')
  @Audit({ action: 'custom-request.cancel', targetType: 'CustomRequest' })
  @HttpCode(200)
  @Post(':id/cancel')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseCustomRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StaffCustomRequest> {
    return this.requests.cancel(id, dto.note, user.id);
  }
}
