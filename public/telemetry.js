// VibeCafé v1 page-view payload, verified against its public client on 2026-09-19.
// Kept here so the website's collection stays consistent with /privacy.
(() => {
  if (
    location.origin !== 'https://md2xarticle.com' ||
    navigator.doNotTrack === '1' ||
    window.doNotTrack === '1' ||
    navigator.globalPrivacyControl === true ||
    window.__vibeCafeTelemetryV1
  ) return;
  window.__vibeCafeTelemetryV1 = true;

  const productId = 'cmu4b884000000agmn23vud8y';
  const storageKey = 'vc:telemetry:visitor:' + productId;
  let visitorId;
  try {
    visitorId = localStorage.getItem(storageKey);
    if (!visitorId) {
      visitorId = crypto.randomUUID();
      localStorage.setItem(storageKey, visitorId);
    }
  } catch {
    visitorId = crypto.randomUUID();
  }

  // This is a one-way event; the endpoint returns no useful response body.
  // Its POST response currently lacks CORS headers. A simple, opaque request
  // delivers the same payload without requiring access to that response.
  // No retries or delivery/success claims: an HTTP response is not ingestion proof.
  void fetch('https://vibecafe.ai/api/products/' + productId + '/telemetry/events', {
    method: 'POST',
    mode: 'no-cors',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    keepalive: true,
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({
      key: 'vc_web_uwddsAW9MiPVS4qjQmK-_qR4xeZXzDrr5NYFzK87xGk',
      visitorId,
      event: 'pageview',
    }),
  }).catch(() => {});
})();
