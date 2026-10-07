//   local → a folder on this server (development and staging)
//   s3    → a PRIVATE bucket on AWS S3 (Mumbai region), Cloudflare R2 or any S3-compatible storage (production)
// Files are never public: the app opens them through the API's short-lived signed links.
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { env } from '../config/env.js';

export interface FileStorage {
  save(key: string, data: Buffer): Promise<void>;
  open(key: string): Promise<Readable>;
  remove(key: string): Promise<void>;
}

// Development/staging: files stored in UPLOADS_DIR on the server disk
class LocalStorage implements FileStorage {
  private readonly dir = env.UPLOADS_DIR;

  private fullPath(key: string): string {
    return path.join(this.dir, key.replace(/\//g, path.sep));
  }

  async save(key: string, data: Buffer): Promise<void> {
    const dest = this.fullPath(key);
    await mkdir(path.dirname(dest), { recursive: true });
    await new Promise<void>((resolve, reject) => {
      const ws = createWriteStream(dest);
      ws.on('finish', resolve);
      ws.on('error', reject);
      ws.end(data);
    });
  }

  async open(key: string): Promise<Readable> {
    const src = this.fullPath(key);
    if (!existsSync(src)) throw new Error(`File not found: ${key}`);
    return createReadStream(src);
  }

  async remove(key: string): Promise<void> {
    const src = this.fullPath(key);
    if (existsSync(src)) await unlink(src);
  }
}

export class S3Storage implements FileStorage {
  constructor(
    private readonly bucket: string,
    private readonly client: S3Client,
  ) {}

  async save(key: string, data: Buffer): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket, Key: key, Body: data,
      ServerSideEncryption: env.S3_ENDPOINT ? undefined : 'AES256', // AWS: encrypted at rest (R2 always encrypts)
    }));
  }

  async open(key: string): Promise<Readable> {
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })); // throws if missing
    if (!(out.Body instanceof Readable)) throw new Error('Unexpected storage response');
    return out.Body;
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

function createStorage(): FileStorage {
  if (env.STORAGE_DRIVER === 'local') return new LocalStorage();
  const client = new S3Client({
    region: env.S3_REGION,
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID ?? '', secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '' },
  });
  return new S3Storage(env.S3_BUCKET ?? '', client);
}

export const storage: FileStorage = createStorage();

// Detect file type from buffer magic bytes (used by documents.service.ts)
export function detectFileType(buffer: Buffer): { mime: string; ext: string } {
  if (buffer[0] === 0x25 && buffer[1] === 0x50) return { mime: 'application/pdf', ext: 'pdf' };
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return { mime: 'image/png', ext: 'png' };
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return { mime: 'image/gif', ext: 'gif' };
  return { mime: 'application/octet-stream', ext: 'bin' };
}
