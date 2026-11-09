/**
 * In-memory StorageAdapter — the ONLY storage used by automated tests.
 *
 * Zero network, deterministic, and instrumented:
 *  - every operation is appended to `calls` (order assertions, e.g. the
 *    operation-order test TA7 and "no DeleteObject ever" tests RC/DL),
 *  - `beforeDelete` runs INSIDE deleteObject, before the object is removed —
 *    used to model the unfenceable check→request race (DL2/DL5),
 *  - `afterList` runs after every LIST, letting a test replace an object
 *    between LIST and HEAD (LR1/LR5),
 *  - per-op error injection models R2 failures (retry/crash-recovery tests).
 *
 * It is intentionally NOT a byte-accurate S3: it models exactly the
 * semantics the workers depend on (see storage/types.ts).
 */

import type { HeadResult, ListPage, RangedRead, StorageAdapter } from "./types";

type MemoryObject = {
  bytes: Uint8Array;
  /** `null` models a missing/unparsable Last-Modified header (LR4/FM1). */
  lastModified: Date | null;
  contentType: string;
};

export type StorageCall = {
  op: "list" | "head" | "read" | "delete" | "presignPut" | "presignGet";
  key?: string;
};

export const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff]);
export const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paddedJpeg(size: number): Uint8Array {
  const bytes = new Uint8Array(Math.max(size, 3));
  bytes.set(JPEG_MAGIC, 0);
  // Fill the rest with a benign pattern (content beyond the magic is not
  // inspected by the server).
  for (let i = 3; i < bytes.length; i += 1) bytes[i] = i % 251;
  return bytes;
}

function paddedPng(size: number): Uint8Array {
  const bytes = new Uint8Array(Math.max(size, 8));
  bytes.set(PNG_MAGIC, 0);
  for (let i = 8; i < bytes.length; i += 1) bytes[i] = i % 251;
  return bytes;
}

export class MemoryStorage implements StorageAdapter {
  readonly kind = "memory" as const;

  objects = new Map<string, MemoryObject>();
  calls: StorageCall[] = [];

  /** Test hooks. */
  beforeDelete: ((key: string) => void | Promise<void>) | null = null;
  afterList: ((page: ListPage) => void | Promise<void>) | null = null;
  listError: Error | null = null;
  headErrors = new Map<string, Error>();
  deleteErrors = new Map<string, Error>();

  /* ---------------- instrumentation ---------------- */

  get deleteCalls(): string[] {
    return this.calls.filter((call) => call.op === "delete").map((call) => call.key ?? "");
  }

  get listCalls(): number {
    return this.calls.filter((call) => call.op === "list").length;
  }

  get headCalls(): number {
    return this.calls.filter((call) => call.op === "head").length;
  }

  resetCalls(): void {
    this.calls = [];
  }

  has(key: string): boolean {
    return this.objects.has(key);
  }

  size(key: string): number | null {
    return this.objects.get(key)?.bytes.length ?? null;
  }

  /* ---------------- seeding ---------------- */

  seed(
    key: string,
    options: {
      lastModified?: Date | null;
      bytes?: Uint8Array;
      contentType?: string;
      family?: "jpeg" | "png";
    } = {},
  ): void {
    const size = options.bytes?.length ?? 1024;
    const bytes =
      options.bytes ?? (options.family === "png" ? paddedPng(size) : paddedJpeg(size));
    this.objects.set(key, {
      bytes,
      lastModified: options.lastModified === undefined ? new Date() : options.lastModified,
      contentType: options.contentType ?? (options.family === "png" ? "image/png" : "image/jpeg"),
    });
  }

  /** Seeds an object whose bytes are NOT a valid image (bad magic bytes). */
  seedCorrupt(key: string, options: { lastModified?: Date; size?: number } = {}): void {
    const size = options.size ?? 512;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) bytes[i] = 0x41; // "AAAA…" — no magic
    this.objects.set(key, {
      bytes,
      lastModified: options.lastModified ?? new Date(),
      contentType: "image/jpeg",
    });
  }

  /** Replaces an object as a new INSTANCE (fresh timestamp) — LR1/LR5. */
  replace(key: string, options: { lastModified?: Date; family?: "jpeg" | "png" } = {}): void {
    this.seed(key, { lastModified: options.lastModified ?? new Date(), family: options.family });
  }

  clear(): void {
    this.objects.clear();
    this.calls = [];
    this.beforeDelete = null;
    this.afterList = null;
    this.listError = null;
    this.headErrors.clear();
    this.deleteErrors.clear();
  }

  /* ---------------- StorageAdapter ---------------- */

  async listObjects(params: {
    prefix: string;
    startAfter?: string | null;
    maxKeys: number;
  }): Promise<ListPage> {
    this.calls.push({ op: "list" });
    if (this.listError) {
      const error = this.listError;
      this.listError = null;
      throw error;
    }

    const keys = [...this.objects.keys()]
      .filter((key) => key.startsWith(params.prefix))
      .filter((key) => !params.startAfter || key > params.startAfter)
      .sort()
      .slice(0, Math.max(1, params.maxKeys));

    const allMatching = [...this.objects.keys()]
      .filter((key) => key.startsWith(params.prefix))
      .filter((key) => !params.startAfter || key > params.startAfter)
      .sort();

    const page: ListPage = {
      objects: keys.map((key) => {
        const object = this.objects.get(key) as MemoryObject;
        return { key, size: object.bytes.length, lastModified: object.lastModified };
      }),
      isTruncated: allMatching.length > keys.length,
      nextStartAfter: allMatching.length > keys.length && keys.length > 0 ? keys[keys.length - 1] : null,
    };

    if (this.afterList) await this.afterList(page);
    return page;
  }

  async headObject(key: string): Promise<HeadResult> {
    this.calls.push({ op: "head", key });
    const injected = this.headErrors.get(key);
    if (injected) {
      this.headErrors.delete(key);
      throw injected;
    }
    const object = this.objects.get(key);
    if (!object) return { found: false };
    return {
      found: true,
      key,
      size: object.bytes.length,
      lastModified: object.lastModified,
      etag: `"${object.bytes.length}-memory"`,
    };
  }

  async readObjectRange(key: string, start: number, endInclusive: number): Promise<RangedRead> {
    this.calls.push({ op: "read", key });
    const object = this.objects.get(key);
    if (!object) return { found: false };
    return { found: true, bytes: object.bytes.slice(start, endInclusive + 1) };
  }

  async deleteObject(key: string): Promise<void> {
    this.calls.push({ op: "delete", key });
    // Hook runs BEFORE the deletion lands — models the lease expiring
    // between the final holdsLease() check and the request reaching R2.
    if (this.beforeDelete) await this.beforeDelete(key);
    const injected = this.deleteErrors.get(key);
    if (injected) {
      this.deleteErrors.delete(key);
      throw injected;
    }
    this.objects.delete(key); // idempotent: absent keys are a no-op success
  }

  async presignPut(params: {
    key: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<{ url: string; method: "PUT"; headers: Record<string, string>; key: string; expiresInSeconds: number }> {
    this.calls.push({ op: "presignPut", key: params.key });
    return {
      key: params.key,
      expiresInSeconds: params.expiresInSeconds,
      url: `memory://put/${params.key}?expires=${params.expiresInSeconds}`,
      method: "PUT",
      headers: { "Content-Type": params.contentType },
    };
  }

  async presignGet(params: {
    key: string;
    expiresInSeconds: number;
  }): Promise<{ url: string; expiresAt: string }> {
    this.calls.push({ op: "presignGet", key: params.key });
    return {
      url: `memory://get/${params.key}?expires=${params.expiresInSeconds}`,
      expiresAt: new Date(Date.now() + params.expiresInSeconds * 1000).toISOString(),
    };
  }
}
