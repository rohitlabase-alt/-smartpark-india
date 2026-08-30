import { describe, expect, it } from "vitest";
import type {
  ObjectStorageProvider,
  PutOptions,
  StoredObject,
  StoredObjectMeta,
} from "../src/storage/object-storage.js";

/**
 * In-memory probe of the ObjectStorageProvider CONTRACT (docs/ARCHITECTURE.md
 * §12). Keeps the interface honest without a running MinIO/AWS in CI.
 * Live end-to-end coverage happens via `npm run check:infra`.
 */
class MemoryStorageProvider implements ObjectStorageProvider {
  private readonly objects = new Map<string, Buffer>();

  private key(bucket: string, key: string): string {
    return `${bucket}/${key}`;
  }

  async put(
    bucket: string,
    key: string,
    data: Buffer,
    _options?: PutOptions,
  ): Promise<StoredObject> {
    this.objects.set(this.key(bucket, key), data);
    return { key };
  }

  async getObject(bucket: string, key: string): Promise<Buffer> {
    const data = this.objects.get(this.key(bucket, key));
    if (!data) throw new Error(`NoSuchKey: ${key}`);
    return data;
  }

  async head(bucket: string, key: string): Promise<StoredObjectMeta> {
    const data = this.objects.get(this.key(bucket, key));
    if (!data) throw new Error(`NoSuchKey: ${key}`);
    return { key, sizeBytes: data.byteLength };
  }

  async getSignedGetUrl(bucket: string, key: string, ttlSeconds: number): Promise<string> {
    return `mock-signed://${bucket}/${key}?ttl=${ttlSeconds}`;
  }

  async delete(bucket: string, key: string): Promise<void> {
    this.objects.delete(this.key(bucket, key));
  }
}

describe("ObjectStorageProvider contract", () => {
  it("round-trips put -> head -> getObject with correct bytes", async () => {
    const provider = new MemoryStorageProvider();
    const key = "doc/operator/42/abc.tmp";
    const payload = Buffer.from("hello-from-minio", "utf8");

    await provider.put("smartpark-documents", key, payload, { contentType: "text/plain" });

    const meta = await provider.head("smartpark-documents", key);
    expect(meta.sizeBytes).toBe(payload.byteLength);

    const downloaded = await provider.getObject("smartpark-documents", key);
    expect(downloaded.toString()).toBe("hello-from-minio");
  });

  it("reports missing keys via thrown error", async () => {
    const provider = new MemoryStorageProvider();
    await expect(provider.getObject("smartpark-documents", "does/not/exist")).rejects.toThrow();
  });

  it("delete removes the object (subsequent head throws)", async () => {
    const provider = new MemoryStorageProvider();
    const key = "parking/1/image.jpg";
    await provider.put("smartpark-documents", key, Buffer.from("img"));
    await provider.delete("smartpark-documents", key);
    await expect(provider.head("smartpark-documents", key)).rejects.toThrow();
  });

  it("getSignedGetUrl carries the requested TTL", async () => {
    const provider = new MemoryStorageProvider();
    await provider.put("smartpark-documents", "a/b", Buffer.from("x"));
    const url = await provider.getSignedGetUrl("smartpark-documents", "a/b", 300);
    expect(url).toBe("mock-signed://smartpark-documents/a/b?ttl=300");
  });
});
