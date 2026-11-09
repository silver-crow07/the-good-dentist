/**
 * Cloudflare R2 storage adapter (S3-compatible API, AWS SDK v3).
 *
 * Construction is env-driven and server-side only — the credentials never
 * leave this module (no endpoint ever returns them; the browser only ever
 * receives short-lived presigned URLs).
 *
 * Endpoint: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` with
 * `region: "auto"` and path-style addressing (matches Cloudflare's
 * documented curl form: `…/<BUCKET>/<KEY>`).
 *
 * Verified vs assumed behaviour is documented in docs/BACKEND.md
 * ("Verified vs assumed R2 behaviour") — the conservative paths here are:
 *   - HeadObject 404 → `{ found: false }` (never throws),
 *   - a missing/Last-Modified header → `lastModified: null` (fail closed),
 *   - DeleteObject is treated as idempotent.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { R2Config } from "../env";
import type { HeadResult, ListPage, RangedRead, StorageAdapter } from "./types";
/** Max keys per ListObjectsV2 page (S3 hard limit). */
const MAX_KEYS_PER_PAGE = 1000;

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    candidate.name === "NotFound" ||
    candidate.name === "NoSuchKey" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

function toDate(value: Date | undefined | null): Date | null {
  if (!value) return null;
  const time = value.getTime();
  return Number.isNaN(time) ? null : value;
}

export class R2StorageAdapter implements StorageAdapter {
  readonly kind = "r2" as const;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: R2Config, client?: S3Client) {
    this.bucket = config.bucket;
    this.client =
      client ??
      new S3Client({
        region: "auto",
        endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
        // Path style = `https://<account>.r2.cloudflarestorage.com/<bucket>/<key>`
        // (the exact form Cloudflare documents); virtual-host style would put
        // the bucket in the hostname, which needs DNS setup we do not have.
        forcePathStyle: true,
      });
  }

  async listObjects(params: {
    prefix: string;
    startAfter?: string | null;
    maxKeys: number;
  }): Promise<ListPage> {
    const maxKeys = Math.max(1, Math.min(MAX_KEYS_PER_PAGE, params.maxKeys));
    const response = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: params.prefix,
        ...(params.startAfter ? { StartAfter: params.startAfter } : {}),
        MaxKeys: maxKeys,
      }),
    );

    const objects = (response.Contents ?? [])
      .map((entry) => {
        if (!entry.Key) return null;
        return {
          key: entry.Key,
          size: Number(entry.Size ?? 0),
          lastModified: toDate(entry.LastModified),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    const isTruncated = Boolean(response.IsTruncated);
    const lastKey = objects.length > 0 ? objects[objects.length - 1].key : null;
    return {
      objects,
      isTruncated,
      // Page is lexicographically sorted, so the last key is the correct
      // `start-after` marker. An empty-but-truncated page would loop forever,
      // so it reports null and the caller stops.
      nextStartAfter: isTruncated && lastKey ? lastKey : null,
    };
  }

  async headObject(key: string): Promise<HeadResult> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        found: true,
        key,
        size: Number(response.ContentLength ?? 0),
        lastModified: toDate(response.LastModified),
        etag: response.ETag ?? null,
      };
    } catch (error) {
      if (isNotFound(error)) return { found: false };
      throw error;
    }
  }

  async readObjectRange(key: string, start: number, endInclusive: number): Promise<RangedRead> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Range: `bytes=${start}-${endInclusive}`,
        }),
      );
      if (!response.Body) return { found: false };
      const bytes = await response.Body.transformToByteArray();
      return { found: true, bytes };
    } catch (error) {
      if (isNotFound(error)) return { found: false };
      // A range beyond the object size also 404/416s — treat "no bytes" as
      // absent so verification fails closed rather than throwing.
      if (
        error &&
        typeof error === "object" &&
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 416
      ) {
        return { found: false };
      }
      throw error;
    }
  }

  async deleteObject(key: string): Promise<void> {
    // S3 semantics: deleting an absent key still succeeds (idempotent).
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async presignPut(params: {
    key: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<{ url: string; method: "PUT"; headers: Record<string, string>; key: string; expiresInSeconds: number }> {
    // F-3 — HONEST LIMITATION: only `Content-Type` is part of this SigV4
    // signature (via the ContentType field → SignedHeaders). Content-Length
    // and the request BODY are NOT signed, so R2 does not and cannot enforce
    // an upload size limit from this URL — do NOT treat a signed
    // Content-Length as a guarantee without verifying it against the actual
    // R2 signature (it is deliberately not passed here: adding unsigned
    // claims would risk breaking uploads without adding security).
    // Size enforcement therefore happens SERVER-SIDE after the PUT:
    // init validates the declared size (MAX_FILE_BYTES) and complete
    // re-reads the object's HEAD size and rejects oversize uploads
    // (`oversize:` reason) before anything can become AVAILABLE.
    // Backstop for abandoned uploads: the prepared (NOT configured) bucket
    // lifecycle rule in docs/BACKEND.md → "Dental storage limitations".
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: params.key,
        // Signing the content type binds it: the browser MUST send exactly
        // this header or R2 rejects the request (signature mismatch).
        ContentType: params.contentType,
      }),
      { expiresIn: params.expiresInSeconds },
    );
    return {
      key: params.key,
      expiresInSeconds: params.expiresInSeconds,
      url,
      method: "PUT",
      headers: { "Content-Type": params.contentType },
    };
  }

  async presignGet(params: {
    key: string;
    expiresInSeconds: number;
  }): Promise<{ url: string; expiresAt: string }> {
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: params.key }),
      { expiresIn: params.expiresInSeconds },
    );
    return { url, expiresAt: new Date(Date.now() + params.expiresInSeconds * 1000).toISOString() };
  }
}

/** Builds the adapter for an explicit configuration (never invents one). */
export function createR2Storage(config: R2Config): StorageAdapter {
  return new R2StorageAdapter(config);
}
