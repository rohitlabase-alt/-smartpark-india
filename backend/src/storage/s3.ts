/**
 * S3-compatible storage adapter (docs/ARCHITECTURE.md §12).
 *
 * Uses the AWS SDK v3 against any S3-compatible endpoint (MinIO in dev, AWS
 * S3 in production). Force-path-style addressing is enabled because MinIO and
 * self-hosted S3 require it; AWS S3 in production can override via
 * MINIO_REGION/forcePathStyle configuration decisions recorded in DECISIONS.md
 * when that phase arrives.
 */
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";
import type {
  ObjectStorageProvider,
  PutOptions,
  SignedPutOptions,
  StoredObject,
  StoredObjectMeta,
} from "./object-storage.js";

function toS3Endpoint(): string {
  const { endpoint, port } = config.storage;
  const base = endpoint.includes("://") ? endpoint : `http://${endpoint}`;
  return /:\d+$/.test(base) ? base : `${base}:${port}`;
}

export class S3StorageProvider implements ObjectStorageProvider {
  private readonly client: S3Client;

  constructor() {
    this.client = new S3Client({
      endpoint: toS3Endpoint(),
      region: config.storage.region,
      forcePathStyle: config.storage.forcePathStyle,
      credentials: {
        accessKeyId: config.storage.accessKey,
        secretAccessKey: config.storage.secretKey,
      },
    });
  }

  async put(
    bucket: string,
    key: string,
    data: Buffer,
    options?: PutOptions,
  ): Promise<StoredObject> {
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: data,
        ContentType: options?.contentType,
      }),
    );
    return { key, etag: toOptionalString(result.ETag) };
  }

  async getObject(bucket: string, key: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!result.Body) {
      throw new Error(`GetObject returned no body for ${bucket}/${key}`);
    }
    const bytes = await result.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async head(bucket: string, key: string): Promise<StoredObjectMeta> {
    const result = await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return {
      key,
      sizeBytes: result.ContentLength ?? 0,
      contentType: result.ContentType,
      etag: toOptionalString(result.ETag),
    };
  }

  async getSignedGetUrl(bucket: string, key: string, ttlSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: ttlSeconds,
    });
  }

  async getSignedPutUrl(bucket: string, key: string, _options?: SignedPutOptions): Promise<string> {
    // v2 of the SDK binds content-length/content-type into the signature;
    // keep it a plain pre-signed PUT for now (large-file uploads are Future,
    // docs/ARCHITECTURE.md §12.3).
    return getSignedUrl(this.client, new PutObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: 300,
    });
  }

  async delete(bucket: string, key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  /** Dev helper: ensure the configured bucket exists (used by check:infra). */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: config.storage.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: config.storage.bucket }));
    }
  }
}

/** S3 returns empty-string ETags occasionally; normalize to undefined. */
function toOptionalString(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}
