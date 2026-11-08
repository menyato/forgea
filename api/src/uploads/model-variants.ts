import { Injectable, Logger } from '@nestjs/common';
import { modelVariantKey, type ModelVariant } from '@forgea/validation';
import { FileStorage } from './file-storage.js';
import { ModelOptimizer, ModelRefusedError } from './model-optimizer.js';

const VARIANTS: readonly ModelVariant[] = ['view', 'lite'];
const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

/** True for the uploads that get compressed copies: STL, GLB and 3MF models. */
export const isModelKey = (key: string) => /\.(stl|glb|3mf)$/.test(key);

/**
 * Stores the compressed copies of an uploaded model next to it. Made right after the upload is
 * accepted; models uploaded before this existed get theirs the first time one is requested.
 */
@Injectable()
export class ModelVariants {
  private readonly logger = new Logger(ModelVariants.name);
  /** One run per model at a time, however many visitors ask for it at once. */
  private readonly running = new Map<string, Promise<void>>();
  /**
   * Models whose file was refused (bad, hostile or too big), and when: asking for their copies
   * again fails at once for a day instead of re-running the work each time. A time-out or a
   * busy queue is not remembered: the next request tries again. Bounded; forgotten on restart.
   */
  private readonly failed = new Map<string, number>();

  constructor(
    private readonly storage: FileStorage,
    private readonly optimizer: ModelOptimizer,
  ) {}

  /** Makes the copies of `originalKey` (an accepted STL or GLB) unless they exist. */
  ensure(originalKey: string): Promise<void> {
    const failedAt = this.failed.get(originalKey);
    if (failedAt !== undefined && Date.now() - failedAt < RETRY_AFTER_MS) {
      return Promise.reject(new Error('This model could not be compressed'));
    }
    let run = this.running.get(originalKey);
    if (!run) {
      run = this.make(originalKey)
        .catch((error: unknown) => {
          if (error instanceof ModelRefusedError) {
            if (this.failed.size >= 1000) {
              this.failed.delete(this.failed.keys().next().value!);
            }
            this.failed.set(originalKey, Date.now());
          }
          throw error;
        })
        .finally(() => this.running.delete(originalKey));
      this.running.set(originalKey, run);
    }
    return run;
  }

  /**
   * Starts making the copies of a just-accepted upload and returns at once: the upload never
   * waits for it, and its bytes are read again from storage only when its turn comes. A model
   * that can't be compressed is only logged (the original still works), and anyone asking for
   * a copy meanwhile waits for this same run.
   */
  startInBackground(originalKey: string): void {
    this.ensure(originalKey).catch((error: unknown) => {
      this.logger.warn(
        `No compressed copies of ${originalKey}: ${(error as Error).message}`,
      );
    });
  }

  private async make(originalKey: string): Promise<void> {
    const missing: ModelVariant[] = [];
    for (const variant of VARIANTS) {
      const existing = await this.storage.open(
        modelVariantKey(originalKey, variant),
      );
      if (existing) existing.stream.destroy();
      else missing.push(variant);
    }
    if (missing.length === 0) return;
    const extension = originalKey.slice(originalKey.lastIndexOf('.') + 1);
    const copies = await this.optimizer.variants(
      () => readAll(this.storage, originalKey),
      extension,
    );
    for (const variant of missing) {
      await this.storage.put(
        modelVariantKey(originalKey, variant),
        copies[variant],
      );
    }
  }
}

/** A stored file's bytes. */
async function readAll(storage: FileStorage, key: string): Promise<Uint8Array> {
  const file = await storage.open(key);
  if (!file) throw new Error('The original file is missing');
  const chunks: Buffer[] = [];
  for await (const chunk of file.stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}
