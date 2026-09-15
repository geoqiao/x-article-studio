import type { BundleAsset, DraftBundle } from './types';

/** The wire protocol is deliberately small: the page can request status or stage a bundle. */
export const BRIDGE_PROTOCOL = 'md2x-article-studio';
export const BRIDGE_PROTOCOL_VERSION = 1;
export const DEFAULT_ARTICLE_STUDIO_ORIGINS = [
  'http://localhost:4318',
  'http://127.0.0.1:4318',
] as const;

export const MAX_ASSETS = 40;
export const MAX_ASSET_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_ASSET_BYTES = 20 * 1024 * 1024;
export const SUPPORTED_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export type BridgeStatus = { available: boolean; version?: string };
export type BridgeResult = { reviewOpened: boolean; jobId: string };

export type BridgeAction = 'status' | 'stage';

export interface BridgeRequestMessage {
  source: typeof BRIDGE_PROTOCOL;
  version: typeof BRIDGE_PROTOCOL_VERSION;
  type: 'request';
  requestId: string;
  action: BridgeAction;
  bundle?: DraftBundle;
}

export interface BridgeResponseMessage {
  source: typeof BRIDGE_PROTOCOL;
  version: typeof BRIDGE_PROTOCOL_VERSION;
  type: 'response';
  requestId: string;
  action: BridgeAction;
  ok: boolean;
  data?: BridgeStatus | BridgeResult;
  error?: { code: string; message: string };
}

export class DraftBundleValidationError extends Error {
  readonly code = 'INVALID_DRAFT_BUNDLE';

  constructor(readonly issues: readonly string[]) {
    super(issues.join('; '));
    this.name = 'DraftBundleValidationError';
  }
}

export class BridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown, maxLength = 1_000_000): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value);
}

/**
 * Return decoded bytes for a standard padded or unpadded base64 string.
 * Returning null instead of throwing keeps the pure bundle validator deterministic.
 */
export function decodedBase64ByteLength(value: string): number | null {
  if (!value || value.length % 4 === 1) return null;
  const paddingStart = value.indexOf('=');
  const dataEnd = paddingStart === -1 ? value.length : paddingStart;
  for (let index = 0; index < dataEnd; index += 1) {
    const code = value.charCodeAt(index);
    const isUpper = code >= 65 && code <= 90;
    const isLower = code >= 97 && code <= 122;
    const isDigit = code >= 48 && code <= 57;
    if (!isUpper && !isLower && !isDigit && code !== 43 && code !== 47) return null;
  }
  const padding = paddingStart === -1 ? 0 : value.length - paddingStart;
  if (padding > 2 || (paddingStart !== -1 && !/^={1,2}$/.test(value.slice(paddingStart)))) return null;
  if (paddingStart !== -1 && value.length % 4 !== 0) return null;
  if (padding === 2 && dataEnd % 4 !== 2) return null;
  if (padding === 1 && dataEnd % 4 !== 3) return null;
  if (padding === 0 && dataEnd % 4 === 1) return null;
  if (dataEnd === 0) {
    return null;
  }
  return Math.floor((value.length * 3) / 4) - padding;
}

/** Decode a validated base64 payload without using Node-only Buffer APIs. */
export function decodeBase64(value: string): Uint8Array {
  if (decodedBase64ByteLength(value) === null) throw new Error('Invalid base64 payload');
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function validateAsset(asset: unknown, index: number, seenSources: Set<string>, seenNames: Set<string>, issues: string[]): number {
  const path = `assets[${index}]`;
  if (!isRecord(asset)) {
    issues.push(`${path} must be an object`);
    return 0;
  }

  const source = asset.source;
  if (!isNonEmptyString(source, 8_192)) issues.push(`${path}.source must be a non-empty string`);
  else if (seenSources.has(source)) issues.push(`${path}.source is duplicated: ${source}`);
  else seenSources.add(source);

  const fileName = asset.fileName;
  if (!isNonEmptyString(fileName, 255) || fileName === '.' || fileName === '..' || /[/\\]/.test(fileName)) {
    issues.push(`${path}.fileName must be a single safe file name`);
  } else if (seenNames.has(fileName)) {
    issues.push(`${path}.fileName is duplicated: ${fileName}`);
  } else {
    seenNames.add(fileName);
  }

  if (typeof asset.mime !== 'string' || !SUPPORTED_IMAGE_MIMES.includes(asset.mime as (typeof SUPPORTED_IMAGE_MIMES)[number])) {
    issues.push(`${path}.mime must be PNG, JPEG, or WebP`);
  }

  const base64 = asset.base64;
  let byteLength = 0;
  if (!isNonEmptyString(base64, 30_000_000)) {
    issues.push(`${path}.base64 must be a non-empty base64 string`);
  } else {
    const decodedLength = decodedBase64ByteLength(base64);
    if (decodedLength === null || decodedLength <= 0) issues.push(`${path}.base64 is not valid base64`);
    else {
      byteLength = decodedLength;
      if (decodedLength > MAX_ASSET_BYTES) issues.push(`${path} exceeds the 5 MiB image limit`);
    }
  }

  if (typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(asset.sha256)) {
    issues.push(`${path}.sha256 must be a 64-character SHA-256 hex digest`);
  }
  return byteLength;
}

/**
 * Validate the page supplied bundle before it crosses the extension boundary.
 * This checks shape, source/name uniqueness, supported media, base64, and both asset caps.
 */
export function validateDraftBundle(value: unknown): DraftBundle {
  const issues: string[] = [];
  if (!isRecord(value)) throw new DraftBundleValidationError(['bundle must be an object']);

  if (value.schemaVersion !== 1) issues.push('schemaVersion must be 1');
  if (!isNonEmptyString(value.jobId, 256)) issues.push('jobId must be a non-empty string');
  if (!isNonEmptyString(value.title, 2_000) || value.title.trim().length === 0) issues.push('title must be a non-empty string of at most 2,000 characters');
  if (typeof value.markdown !== 'string' || value.markdown.length > 200_000) issues.push('markdown must be a string of at most 200,000 characters');
  if (!isNonEmptyString(value.createdAt, 256)) issues.push('createdAt must be a non-empty string');

  if (!Array.isArray(value.assets)) {
    issues.push('assets must be an array');
  } else {
    if (value.assets.length > MAX_ASSETS) issues.push(`assets cannot contain more than ${MAX_ASSETS} images`);
    const seenSources = new Set<string>();
    const seenNames = new Set<string>();
    let totalBytes = 0;
    value.assets.forEach((asset, index) => {
      totalBytes += validateAsset(asset, index, seenSources, seenNames, issues);
    });
    if (totalBytes > MAX_TOTAL_ASSET_BYTES) issues.push('assets exceed the 20 MiB decoded total limit');
  }

  if (issues.length) throw new DraftBundleValidationError(issues);
  return value as DraftBundle;
}

function bytesToHex(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) result += byte.toString(16).padStart(2, '0');
  return result;
}

/** Recheck declared SHA-256 values before staging or using bundle bytes. */
export async function verifyDraftBundleHashes(bundle: DraftBundle): Promise<void> {
  const validated = validateDraftBundle(bundle);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new BridgeError('HASH_UNAVAILABLE', 'Web Crypto is unavailable; cannot verify image assets.');

  for (let index = 0; index < validated.assets.length; index += 1) {
    const asset: BundleAsset = validated.assets[index];
    const bytes = decodeBase64(asset.base64);
    // Give Web Crypto an owned ArrayBuffer. TS 5.9 correctly rejects a view
    // whose backing buffer may be SharedArrayBuffer based.
    const ownedBytes = new Uint8Array(bytes.byteLength);
    ownedBytes.set(bytes);
    const digest = new Uint8Array(await subtle.digest('SHA-256', ownedBytes.buffer));
    const actual = bytesToHex(digest);
    if (actual !== asset.sha256.toLowerCase()) {
      throw new BridgeError('ASSET_HASH_MISMATCH', `Asset ${asset.fileName} failed its SHA-256 check.`);
    }
  }
}

function makeRequestId(): string {
  const randomUuid = globalThis.crypto?.randomUUID;
  if (randomUuid) return randomUuid.call(globalThis.crypto);
  return `article-studio-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isBridgeResponse(value: unknown): value is BridgeResponseMessage {
  if (!isRecord(value)) return false;
  return (
    value.source === BRIDGE_PROTOCOL &&
    value.version === BRIDGE_PROTOCOL_VERSION &&
    value.type === 'response' &&
    typeof value.requestId === 'string' &&
    (value.action === 'status' || value.action === 'stage') &&
    typeof value.ok === 'boolean'
  );
}

const STATUS_TIMEOUT_MS = 2_000;
const STAGE_TIMEOUT_MS = 30_000;

async function requestExtension<T extends BridgeStatus | BridgeResult>(action: BridgeAction, bundle?: DraftBundle): Promise<T> {
  if (typeof window === 'undefined' || !window.location?.origin) {
    throw new BridgeError('UNAVAILABLE', 'The article studio bridge requires a browser window.');
  }

  const requestId = makeRequestId();
  const origin = window.location.origin;
  const message: BridgeRequestMessage = {
    source: BRIDGE_PROTOCOL,
    version: BRIDGE_PROTOCOL_VERSION,
    type: 'request',
    requestId,
    action,
    ...(bundle ? { bundle } : {}),
  };

  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timeoutId);
      callback();
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== origin || !isBridgeResponse(event.data)) return;
      if (event.data.requestId !== requestId || event.data.action !== action) return;
      finish(() => {
        if (event.data.ok && event.data.data) resolve(event.data.data as T);
        else reject(new BridgeError(event.data.error?.code ?? 'BRIDGE_ERROR', event.data.error?.message ?? 'Extension bridge request failed.'));
      });
    };
    const timeoutId = window.setTimeout(() => {
      finish(() => reject(new BridgeError('TIMEOUT', 'The Article Studio extension did not respond.')));
    }, action === 'stage' ? STAGE_TIMEOUT_MS : STATUS_TIMEOUT_MS);

    window.addEventListener('message', onMessage);
    try {
      window.postMessage(message, origin);
    } catch (error) {
      finish(() => reject(new BridgeError('POST_MESSAGE_FAILED', error instanceof Error ? error.message : String(error))));
    }
  });
}

/** Probe for the companion without exposing any extension state to the page. */
export async function getBridgeStatus(): Promise<BridgeStatus> {
  try {
    const status = await requestExtension<BridgeStatus>('status');
    if (!status.available) return { available: false };
    return typeof status.version === 'string' ? { available: true, version: status.version } : { available: true };
  } catch {
    return { available: false };
  }
}

/** Stage a prepared bundle for explicit review in the extension. */
export async function sendDraft(bundle: DraftBundle): Promise<BridgeResult> {
  const validated = validateDraftBundle(bundle);
  await verifyDraftBundleHashes(validated);
  const result = await requestExtension<BridgeResult>('stage', validated);
  if (typeof result.jobId !== 'string' || typeof result.reviewOpened !== 'boolean') {
    throw new BridgeError('INVALID_RESPONSE', 'The extension returned an invalid staging response.');
  }
  return result;
}
