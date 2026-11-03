import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Upload } from '../generated/prisma/client.js';
import { modelVariantKey, parseModelVariantKey } from '@forgea/validation';
import { UploadStatus, type UploadPurpose } from '../generated/prisma/enums.js';
import { FileInspector } from './file-inspector.js';
import { FileStorage } from './file-storage.js';
import { isModelKey, ModelVariants } from './model-variants.js';
import { UPLOAD_POLICIES } from './upload-policies.js';

export interface IncomingFile {
  data: Uint8Array;
  originalName: string;
}

/**
 * Every upload goes: quarantine → inspect → clean (or rejected). Nothing is ever served
 * from quarantine, and rejected bytes are deleted; the row stays for the audit trail.
 */
@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorage,
    private readonly inspector: FileInspector,
    private readonly variants: ModelVariants,
  ) {}

  async receive(
    file: IncomingFile,
    purpose: UploadPurpose,
    uploadedById: string | null,
  ): Promise<Upload> {
    const objectId = randomUUID();
    const quarantineKey = `quarantine/${objectId}`;
    await this.storage.put(quarantineKey, file.data);

    const upload = await this.prisma.upload.create({
      data: {
        purpose,
        storageKey: quarantineKey,
        originalName: sanitizeName(file.originalName),
        mimeType: 'application/octet-stream',
        sizeBytes: file.data.byteLength,
        sha256: createHash('sha256').update(file.data).digest('hex'),
        uploadedById,
      },
    });

    const result = await this.inspector.inspect(
      file.data,
      UPLOAD_POLICIES[purpose],
    );
    if (!result.ok) {
      await this.storage.remove(quarantineKey);
      return this.prisma.upload.update({
        where: { id: upload.id },
        data: {
          status: UploadStatus.REJECTED,
          rejectionReason: result.reason,
          inspectedAt: new Date(),
        },
      });
    }

    const cleanKey = `clean/${objectId}.${result.extension}`;
    await this.storage.move(quarantineKey, cleanKey);
    // The compressed copies are made in the background: the upload never waits for them.
    if (isModelKey(cleanKey)) this.variants.startInBackground(cleanKey);
    return this.prisma.upload.update({
      where: { id: upload.id },
      data: {
        status: UploadStatus.CLEAN,
        storageKey: cleanKey,
        mimeType: result.mimeType,
        inspectedAt: new Date(),
      },
    });
  }

  /** Every key must be an accepted (CLEAN) upload made for this purpose. */
  async requireClean(
    keys: readonly string[],
    purpose: UploadPurpose,
  ): Promise<void> {
    if (keys.length === 0) return;
    const found = await this.prisma.upload.count({
      where: {
        storageKey: { in: [...keys] },
        status: UploadStatus.CLEAN,
        purpose,
      },
    });
    if (found !== new Set(keys).size) {
      throw new BadRequestException(
        'A file was not uploaded here; upload it again',
      );
    }
  }

  /** Bytes this person uploaded for this purpose since a moment (their daily allowance). */
  async bytesUploadedSince(
    userId: string,
    purpose: UploadPurpose,
    since: Date,
  ): Promise<number> {
    const total = await this.prisma.upload.aggregate({
      _sum: { sizeBytes: true },
      where: { uploadedById: userId, purpose, createdAt: { gte: since } },
    });
    return total._sum.sizeBytes ?? 0;
  }

  /**
   * Deletes an accepted file's bytes, and its compressed copies. The row stays, marked with
   * why, for the audit trail; the key can never be served or attached again.
   */
  async discard(
    upload: { id: string; storageKey: string },
    reason: string,
  ): Promise<void> {
    await this.prisma.upload.update({
      where: { id: upload.id },
      data: { status: UploadStatus.REJECTED, rejectionReason: reason },
    });
    await this.storage.remove(upload.storageKey);
    if (isModelKey(upload.storageKey)) {
      for (const variant of ['view', 'lite'] as const) {
        await this.storage.remove(modelVariantKey(upload.storageKey, variant));
      }
    }
  }

  /** The key must be an accepted upload this person made, for this purpose. */
  async requireOwn(
    key: string,
    purpose: UploadPurpose,
    userId: string,
  ): Promise<{ mimeType: string }> {
    const upload = await this.prisma.upload.findFirst({
      where: {
        storageKey: key,
        status: UploadStatus.CLEAN,
        purpose,
        uploadedById: userId,
      },
      select: { mimeType: true },
    });
    if (!upload) {
      throw new BadRequestException('Upload the file again, then send it');
    }
    return upload;
  }

  /** An accepted upload with exactly these bytes, so re-importing a file stores it once. */
  async findCleanBySha256(
    sha256: string,
    purpose: UploadPurpose,
  ): Promise<string | null> {
    const upload = await this.prisma.upload.findFirst({
      where: { sha256, purpose, status: UploadStatus.CLEAN },
      select: { storageKey: true },
    });
    return upload?.storageKey ?? null;
  }

  /** The whole file, e.g. to measure a 3D model on the server. */
  async read(key: string): Promise<Uint8Array> {
    const file = await this.storage.open(key);
    if (!file) throw new NotFoundException('File not found');
    const chunks: Buffer[] = [];
    for await (const chunk of file.stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  /**
   * An accepted file's bytes. Shoppers get only files shown on an active product, and the
   * files they uploaded themselves; staff (in the dashboard) get any accepted file. Others get
   * 404, as if it didn't exist. A model's compressed copy follows its original's rules.
   */
  async media(
    requestedKey: string,
    viewer: { staff: boolean; userId: string | null },
  ): Promise<{ stream: Readable; size: number; mimeType: string }> {
    const copy = parseModelVariantKey(requestedKey);
    const upload = await this.prisma.upload.findFirst({
      where: {
        // The original of a compressed copy is the STL or GLB with its stem: named exactly, so
        // the unique index finds it (a prefix search reads every upload).
        storageKey: copy
          ? { in: [`${copy.stem}.stl`, `${copy.stem}.glb`] }
          : requestedKey,
        status: UploadStatus.CLEAN,
      },
      select: { storageKey: true, mimeType: true, uploadedById: true },
    });
    const key = upload?.storageKey ?? requestedKey;
    const visible =
      upload &&
      (viewer.staff ||
        (viewer.userId !== null &&
          (upload.uploadedById === viewer.userId ||
            // The studio's design for one of their own requests.
            (await this.prisma.customRequest.count({
              where: { userId: viewer.userId, designPreviewKey: key },
            })) > 0)) ||
        (await this.prisma.product.count({
          where: {
            active: true,
            OR: [{ modelFileKey: key }, { imageKeys: { has: key } }],
          },
        })) > 0 ||
        // A font customers write in: the live preview loads it.
        (await this.prisma.font.count({
          where: { active: true, fileKey: key },
        })) > 0);
    if (!upload || !visible) throw new NotFoundException('File not found');
    if (!copy) {
      const file = await this.storage.open(key);
      if (!file) throw new NotFoundException('File not found');
      return { ...file, mimeType: upload.mimeType };
    }
    if (!isModelKey(key)) throw new NotFoundException('File not found');
    let file = await this.storage.open(requestedKey);
    if (!file) {
      // A copy that can't be made (refused file, busy queue) is simply not there: 404.
      await this.variants.ensure(key).catch(() => undefined);
      file = await this.storage.open(requestedKey);
    }
    if (!file) throw new NotFoundException('File not found');
    return { ...file, mimeType: 'model/gltf-binary' };
  }
}

/** For display to staff only: no path parts, no control characters, bounded length. */
export function sanitizeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = base
    // Control characters are exactly what this removes.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 200);
  return clean || 'upload';
}
