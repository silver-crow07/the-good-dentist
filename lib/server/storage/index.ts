/**
 * Storage adapter factory (Phase D).
 *
 * Resolution order:
 *   1. explicit test override (`setStorageForTests`) — every automated test
 *      uses the in-memory fake, so CI never touches the network,
 *   2. real R2 built from `R2_*` environment variables,
 *   3. `null` — storage not configured: file endpoints answer 503 and the
 *      cleanup workers skip the R2-touching jobs (they never fake success).
 *
 * R2 credentials are read here and never leave the server.
 */

import { getR2Config } from "../env";
import { createR2Storage } from "./r2";
import type { StorageAdapter } from "./types";

export type { StorageAdapter } from "./types";

let testOverride: StorageAdapter | null = null;
let cached: { signature: string; adapter: StorageAdapter } | null = null;

/** Tests only — injects the in-memory fake (pass `null` to clear). */
export function setStorageForTests(adapter: StorageAdapter | null): void {
  testOverride = adapter;
}

/** The active adapter, or `null` when storage is not configured. */
export function getStorage(): StorageAdapter | null {
  if (testOverride) return testOverride;

  const config = getR2Config();
  if (!config) return null;

  // Rebuild only when the configuration actually changes (dev hot reload).
  const signature = `${config.accountId}|${config.bucket}|${config.accessKeyId}`;
  if (cached && cached.signature === signature) return cached.adapter;

  const adapter = createR2Storage(config);
  cached = { signature, adapter };
  return adapter;
}
