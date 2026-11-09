/**
 * Storage adapter contract for private object storage (Phase D).
 *
 * One narrow interface serves two implementations:
 *  - `r2.ts`   — real Cloudflare R2 via the AWS S3-compatible API.
 *  - `memory.ts` — an in-memory fake used by every automated test (zero
 *                  network, deterministic clocks, injectable failure hooks).
 *
 * Semantics that the cleanup workers rely on (see docs/BACKEND.md →
 * "Verified vs assumed R2 behaviour"):
 *  - `headObject` on a missing key resolves `{ found: false }` — it does NOT
 *    throw. A missing/invalid timestamp is surfaced as `lastModified: null`
 *    so callers fail CLOSED (never delete on an unparseable age).
 *  - `deleteObject` is idempotent: deleting an absent key succeeds.
 *  - `listObjects` is a snapshot only. Its `lastModified` values are an
 *    OPTIMIZATION (may defer a deletion) and never authorization.
 */

export type HeadResult =
  | { found: false }
  | {
      found: true;
      key: string;
      /** Byte length; compared against the declared size on complete. */
      size: number;
      /** `null` when R2 omits/unparses the timestamp — fail closed. */
      lastModified: Date | null;
      /** Diagnostic only — never compared to authorize anything. */
      etag: string | null;
    };

export type ListedObject = {
  key: string;
  size: number;
  /** `null` when missing/unparsable — callers must then use HeadObject. */
  lastModified: Date | null;
};

export type ListPage = {
  objects: ListedObject[];
  isTruncated: boolean;
  /** Value to pass as `startAfter` for the next page (null when done). */
  nextStartAfter: string | null;
};

export type RangedRead = { found: false } | { found: true; bytes: Uint8Array };

export type PresignParams = {
  key: string;
  expiresInSeconds: number;
};

export type PresignedPut = PresignParams & {
  url: string;
  method: "PUT";
  /** The browser MUST send exactly this header (it is signed). */
  headers: Record<string, string>;
};

export interface StorageAdapter {
  readonly kind: "r2" | "memory";
  listObjects(params: { prefix: string; startAfter?: string | null; maxKeys: number }): Promise<ListPage>;
  headObject(key: string): Promise<HeadResult>;
  /** Bytes `[start, endInclusive]` — used for magic-byte verification. */
  readObjectRange(key: string, start: number, endInclusive: number): Promise<RangedRead>;
  /** Idempotent: succeeds when the key is already absent. */
  deleteObject(key: string): Promise<void>;
  presignPut(params: { key: string; contentType: string; expiresInSeconds: number }): Promise<PresignedPut>;
  presignGet(params: PresignParams): Promise<{ url: string; expiresAt: string }>;
}
