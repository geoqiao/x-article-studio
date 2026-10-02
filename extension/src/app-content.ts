import {
  BRIDGE_PROTOCOL,
  BRIDGE_PROTOCOL_VERSION,
  DEFAULT_ARTICLE_STUDIO_ORIGINS,
  isBridgeAction,
  type BridgeRequestMessage,
  type BridgeResponseMessage,
} from '../../src/bridge.js';

declare const __ARTICLE_STUDIO_ORIGINS__: readonly string[];

const configuredOrigins: readonly string[] =
  typeof __ARTICLE_STUDIO_ORIGINS__ === 'undefined' ? DEFAULT_ARTICLE_STUDIO_ORIGINS : __ARTICLE_STUDIO_ORIGINS__;

function isAllowedOrigin(origin: string): boolean {
  return configuredOrigins.includes(origin);
}

function isRequestMessage(value: unknown): value is BridgeRequestMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<BridgeRequestMessage>;
  return (
    message.source === BRIDGE_PROTOCOL &&
    message.version === BRIDGE_PROTOCOL_VERSION &&
    message.type === 'request' &&
    typeof message.requestId === 'string' &&
    message.requestId.length > 0 &&
    isBridgeAction(message.action)
  );
}

function errorResponse(request: BridgeRequestMessage, code: string, message: string): BridgeResponseMessage {
  return {
    source: BRIDGE_PROTOCOL,
    version: BRIDGE_PROTOCOL_VERSION,
    type: 'response',
    requestId: request.requestId,
    action: request.action,
    ok: false,
    error: { code, message },
  };
}

function postToPage(response: BridgeResponseMessage): void {
  window.postMessage(response, location.origin);
}

function install(): void {
  if (!isAllowedOrigin(location.origin)) return;

  window.addEventListener('message', (event: MessageEvent) => {
    // The page is the only sender accepted. This prevents an iframe from using
    // the content script as a bridge into the extension.
    if (event.source !== window || event.origin !== location.origin) return;
    const request = event.data;
    if (!isRequestMessage(request)) return;

    try {
      chrome.runtime.sendMessage({ type: 'article-studio-page-request', request }, (response: unknown) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          postToPage(errorResponse(request, 'EXTENSION_UNAVAILABLE', runtimeError.message ?? 'The extension is unavailable.'));
          return;
        }
        if (response && typeof response === 'object') {
          postToPage(response as BridgeResponseMessage);
        } else {
          postToPage(errorResponse(request, 'EMPTY_RESPONSE', 'The Article Studio extension returned no response.'));
        }
      });
    } catch (error) {
      postToPage(errorResponse(request, 'EXTENSION_UNAVAILABLE', error instanceof Error ? error.message : String(error)));
    }
  });
}

const isolatedGlobal = globalThis as typeof globalThis & { __articleStudioAppContentInstalled?: boolean };
if (!isolatedGlobal.__articleStudioAppContentInstalled) {
  isolatedGlobal.__articleStudioAppContentInstalled = true;
  install();
}
