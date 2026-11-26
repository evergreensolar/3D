export interface PutOptions {
  contentType: string;
  /** Suggested filename for downloads (Content-Disposition). */
  downloadName?: string;
}

export interface UrlOptions {
  expiresInSec?: number;
  /** Force a download with this filename instead of inline display. */
  downloadName?: string;
}

/** S3-compatible object storage abstraction. Swap drivers with STORAGE_DRIVER. */
export interface StorageProvider {
  readonly name: string;
  put(key: string, body: Buffer | Uint8Array, opts: PutOptions): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** A time-limited URL a browser (or the render worker) can fetch the object from. */
  getUrl(key: string, opts?: UrlOptions): Promise<string>;
}
