/**
 * Object storage abstraction (docs/ARCHITECTURE.md §12).
 *
 * Provider-agnostic: S3StorageProvider (S3-compatible, works with MinIO/AWS
 * S3/any S3 provider) is the out-of-the-box adapter. The application must
 * only ever depend on `ObjectStorageProvider` — never on a concrete vendor.
 *
 * Capability coverage:
 *   put            -> "putObject" (write bytes)
 *   getObject/head -> "getObject" (download / stat)
 *   delete         -> "deleteObject"
 *   getSignedGetUrl / getSignedPutUrl -> "createSignedUrl"
 */
export interface StoredObject {
  key: string;
  etag?: string;
}

export interface StoredObjectMeta {
  key: string;
  sizeBytes: number;
  contentType?: string;
  etag?: string;
}

export interface PutOptions {
  contentType?: string;
}

export interface SignedPutOptions {
  contentType?: string;
  maxSizeBytes?: number;
}

export interface ObjectStorageProvider {
  /** Upload bytes. Returns storage metadata (key + server etag). */
  put(bucket: string, key: string, data: Buffer, options?: PutOptions): Promise<StoredObject>;

  /** Download the object bytes. */
  getObject(bucket: string, key: string): Promise<Buffer>;

  /** Stat an existing object. Throws if the key does not exist. */
  head(bucket: string, key: string): Promise<StoredObjectMeta>;

  /** Short-lived pre-signed GET URL (docs/ARCHITECTURE.md §12.5). */
  getSignedGetUrl(bucket: string, key: string, ttlSeconds: number): Promise<string>;

  /** Optional: pre-signed PUT URL for large-file client uploads (future). */
  getSignedPutUrl?(bucket: string, key: string, options?: SignedPutOptions): Promise<string>;

  /** Idempotent delete. Missing keys must not throw. */
  delete(bucket: string, key: string): Promise<void>;
}
