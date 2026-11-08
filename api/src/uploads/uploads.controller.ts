import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { UploadedFile as UploadedFileView } from '@forgea/types';
import type { AuthenticatedUser } from '../authorization/authenticated-user.js';
import { CurrentUser, RequirePermission } from '../authorization/decorators.js';
import type { Upload } from '../generated/prisma/client.js';
import { UploadPurpose, UploadStatus } from '../generated/prisma/enums.js';
import { UPLOAD_POLICIES } from './upload-policies.js';
import { UploadsService } from './uploads.service.js';

/** Multer's limit for one purpose: oversized bodies are refused while streaming. */
const single = (purpose: UploadPurpose) =>
  FileInterceptor('file', {
    limits: {
      fileSize: UPLOAD_POLICIES[purpose].maxBytes,
      files: 1,
      fields: 0,
    },
  });

/**
 * Dashboard uploads. The answer is the object key to save on the product; the file goes
 * through the same quarantine and inspection as every upload.
 */
@RequirePermission('catalog.manage')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  /** A 3D model shown on the product page: STL or GLB. */
  @Post('product-model')
  @UseInterceptors(single(UploadPurpose.PRODUCT_MODEL))
  model(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UploadedFileView> {
    return this.accept(file, UploadPurpose.PRODUCT_MODEL, user);
  }

  /** A font for personalised text: TTF or OTF (Dashboard → Fonts). */
  @Post('font')
  @UseInterceptors(single(UploadPurpose.FONT))
  font(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UploadedFileView> {
    return this.accept(file, UploadPurpose.FONT, user);
  }

  /** A 3MF (or STL/GLB) a quotation line is made from: whoever writes quotations. */
  @RequirePermission('quotations.manage')
  @Post('quotation-file')
  @UseInterceptors(single(UploadPurpose.QUOTATION_FILE))
  quotationFile(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UploadedFileView> {
    return this.accept(file, UploadPurpose.QUOTATION_FILE, user);
  }

  /** A product photo: PNG, JPEG or WebP. */
  @Post('product-image')
  @UseInterceptors(single(UploadPurpose.PRODUCT_IMAGE))
  image(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UploadedFileView> {
    return this.accept(file, UploadPurpose.PRODUCT_IMAGE, user);
  }

  private async accept(
    file: Express.Multer.File | undefined,
    purpose: UploadPurpose,
    user: AuthenticatedUser,
  ): Promise<UploadedFileView> {
    if (!file) throw new BadRequestException('Choose a file to upload');
    const upload = await this.uploads.receive(
      { data: file.buffer, originalName: file.originalname },
      purpose,
      user.id,
    );
    if (upload.status !== UploadStatus.CLEAN) {
      throw new BadRequestException(upload.rejectionReason ?? 'File refused');
    }
    return toView(upload);
  }
}

function toView(u: Upload): UploadedFileView {
  return {
    key: u.storageKey,
    mimeType: u.mimeType,
    sizeBytes: u.sizeBytes,
    originalName: u.originalName,
  };
}
