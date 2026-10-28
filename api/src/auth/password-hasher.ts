import { Injectable, type OnModuleInit } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/**
 * argon2id with the OWASP-recommended minimum (19 MiB memory, 2 iterations, 1 lane).
 * Argon2id is the library default; the stored hash records its own parameters, so they
 * can be raised later without breaking existing passwords.
 */
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordHasher implements OnModuleInit {
  /** Verified against when the account doesn't exist, so response time doesn't reveal it. */
  private dummyHash = '';

  async onModuleInit(): Promise<void> {
    this.dummyHash = await hash('forgea-timing-equalizer', OPTIONS);
  }

  hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /** Spends the same time as a real check, then fails. */
  async verifyNothing(password: string): Promise<false> {
    if (!this.dummyHash) await this.onModuleInit();
    await this.verify(this.dummyHash, password);
    return false;
  }
}
