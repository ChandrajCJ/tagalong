import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '../env';

/** The settings storage needs; the API's full Env satisfies it, and so does the worker's. */
type StorageEnv = Pick<
  Env,
  'S3_ENDPOINT' | 'S3_REGION' | 'S3_BUCKET' | 'S3_ACCESS_KEY' | 'S3_SECRET_KEY'
> &
  Partial<Pick<Env, 'S3_PUBLIC_ENDPOINT'>>;

/** What the file lives in. Swapped for a fake in tests. */
export interface Storage {
  /** A link the phone can PUT the file straight to, so it never passes through us. */
  uploadUrl(key: string, contentType: string, expiresIn: number): Promise<string>;
  /** A short-lived link to read the file. Nothing in storage is ever public. */
  downloadUrl(key: string, fileName: string, expiresIn: number): Promise<string>;
  /** The object's size, or null if the upload never arrived. */
  sizeOf(key: string): Promise<number | null>;
  /** The bytes themselves, for background work such as making thumbnails. */
  read(key: string): Promise<Buffer | null>;
  write(key: string, body: Buffer, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const clientFor = (env: StorageEnv, endpoint: string) =>
  new S3Client({
    endpoint,
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    /*
     * The SDK otherwise adds a CRC32 checksum header that SeaweedFS rejects
     * with "BadDigest", and on a presigned URL the header is part of the
     * signature, so the upload fails before it starts.
     */
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

export const s3Storage = (env: StorageEnv): Storage => {
  // How we reach storage ourselves.
  const client = clientFor(env, env.S3_ENDPOINT);
  /*
   * How phones reach it, for the links we sign. These can differ: "localhost"
   * from a phone is the phone itself, and in production the bucket sits behind
   * a public domain. The host is part of the signature, so links must be
   * signed for the address they'll actually be opened at.
   */
  const signer = env.S3_PUBLIC_ENDPOINT ? clientFor(env, env.S3_PUBLIC_ENDPOINT) : client;

  return {
    uploadUrl: (key, contentType, expiresIn) =>
      getSignedUrl(
        signer,
        new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, ContentType: contentType }),
        { expiresIn },
      ),

    downloadUrl: (key, fileName, expiresIn) =>
      getSignedUrl(
        signer,
        new GetObjectCommand({
          Bucket: env.S3_BUCKET,
          Key: key,
          // Makes browsers and the phone save it under its real name.
          ResponseContentDisposition: `inline; filename="${fileName.replace(/"/g, '')}"`,
        }),
        { expiresIn },
      ),

    async sizeOf(key) {
      try {
        const head = await client.send(
          new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
        );
        return head.ContentLength ?? 0;
      } catch {
        return null;
      }
    },

    async read(key) {
      try {
        const object = await client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
        const bytes = await object.Body?.transformToByteArray();
        return bytes ? Buffer.from(bytes) : null;
      } catch {
        return null;
      }
    },

    async write(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: contentType }),
      );
    },

    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    },
  };
};

/** Creates the bucket on first run, so a fresh checkout needs no setup step. */
export const ensureBucket = async (env: StorageEnv) => {
  const client = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  });
  try {
    await client.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
  } catch {
    // Already there, or storage isn't running yet: either way, not fatal here.
  }
};
