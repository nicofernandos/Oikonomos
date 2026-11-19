import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const derive = (password: string, salt: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });

@Injectable()
export class PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const key = await derive(password, salt);
    return `scrypt$${salt}$${key.toString('hex')}`;
  }

  async verify(password: string, stored?: string): Promise<boolean> {
    const match = /^scrypt\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(stored ?? '');
    // An unknown user still incurs the same password derivation cost.
    const key = await derive(password, match?.[1] ?? '0'.repeat(32));
    const expected = Buffer.from(match?.[2] ?? '0'.repeat(128), 'hex');
    return timingSafeEqual(key, expected) && match !== null;
  }
}
