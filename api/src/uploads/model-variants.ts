import { Injectable, Logger } from '@nestjs/common';
import { modelVariantKey, type ModelVariant } from '@forgea/validation';
import { FileStorage } from './file-storage.js';
import { ModelOptimizer } from './model-optimizer.js';

const VARIANTS: readonly ModelVariant[] = ['view', 'lite'];

/** True for the uploads that get compressed copies: STL and GLB models. */
export const isModelKey = (key: string) => /\.(stl|glb)$/.test(key);

/**
 * Stores the compressed copies of an uploaded model next to it. Made right after the upload is
 * accepted; models uploaded before this existed get theirs the first time one is requested.
 */
@Injectable()
export class ModelVariants {
  private readonly logger = new Logger(ModelVariants.name);
  /** One run per model at a time, however many visitors ask for it at once. */
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    private readonly storage: FileStorage,
    private readonly optimizer: ModelOptimizer,
  ) {}

  /** Makes the copies of `originalKey` (an accepted STL or GLB) unless they exist. */
  ensure(originalKey: string, data?: Uint8Array): Promise<void> {
    let run = this.running.get(originalKey);
    if (!run) {
      run = this.make(originalKey, data).finally(() =>
        this.running.delete(originalKey),
      );
      this.running.set(originalKey, run);
    }
    return run;
  }

  /** Like `ensure`, but a model that can't be compressed is only logged (the original still works). */
  async tryEnsure(originalKey: string, data: Uint8Array): Promise<void> {
    try {
      await this.ensure(originalKey, data);
    } catch (error) {
      this.logger.warn(
        `No compressed copies of ${originalKey}: ${(error as Error).message}`,
      );
    }
  }

  private async make(originalKey: string, data?: Uint8Array): Promise<void> {
    const missing: ModelVariant[] = [];
    for (const variant of VARIANTS) {
      const existing = await this.storage.open(
        modelVariantKey(originalKey, variant),
      );
      if (existing) existing.stream.destroy();
      else missing.push(variant);
    }
    if (missing.length === 0) return;
    const bytes = data ?? (await this.read(originalKey));
    const extension = originalKey.slice(originalKey.lastIndexOf('.') + 1);
    const copies = await this.optimizer.variants(bytes, extension);
    for (const variant of missing) {
      await this.storage.put(
        modelVariantKey(originalKey, variant),
        copies[variant],
      );
    }
  }

  private async read(key: string): Promise<Uint8Array> {
    const file = await this.storage.open(key);
    if (!file) throw new Error('The original file is missing');
    const chunks: Buffer[] = [];
    for await (const chunk of file.stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }
}
