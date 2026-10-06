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

/** What the file lives in. Swapped for a fake in tests. */
export interface Storage {
  /** A link the phone can PUT the file straight to, so it never passes through us. */
  uploadUrl(key: string, contentType: string, expiresIn: number): Promise<string>;
  /** A short-lived link to read the file. Nothing in storage is ever public. */
  downloadUrl(key: string, fileName: string, expiresIn: number): Promise<string>;
  /** The object's size, or null if the upload never arrived. */
  sizeOf(key: string): Promise<number | null>;
  remove(key: string): Promise<void>;
}

export const s3Storage = (env: Env): Storage => {
  const client = new S3Client({
    endpoint: env.S3_ENDPOINT,
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

  return {
    uploadUrl: (key, contentType, expiresIn) =>
      getSignedUrl(
        client,
        new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, ContentType: contentType }),
        { expiresIn },
      ),

    downloadUrl: (key, fileName, expiresIn) =>
      getSignedUrl(
        client,
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

    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    },
  };
};

/** Creates the bucket on first run, so a fresh checkout needs no setup step. */
export const ensureBucket = async (env: Env) => {
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
