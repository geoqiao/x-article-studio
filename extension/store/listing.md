# Chrome Web Store listing

Item ID: `ojpjldmiiibgjnbjfiacaoenfgpdhbbh`
Published version: 0.1.0. Prepared update: 0.1.1 (automatic X Articles tab opening).
Status: **Published** — public version 0.1.0 listing verified September 19, 2026; store update date September 17, 2026.
Automatic publication after approval: enabled.

- [Developer dashboard](https://chrome.google.com/webstore/devconsole/10ecee90-d360-49ac-9f0c-51eb74e01d7e/ojpjldmiiibgjnbjfiacaoenfgpdhbbh/edit/status)
- [Store listing](https://chromewebstore.google.com/detail/ojpjldmiiibgjnbjfiacaoenfgpdhbbh)

The listing uses the website's logo, two screenshots, and the small promotional tile below. Category: Tools. Language: English. Distribution: free and public. The submission was accepted on September 16. The public listing is now available.

The description below includes automatic X Articles tab opening in 0.1.1, the September 19 clarification separating extension privacy from website statistics, and canonical support/privacy URLs. The new package and metadata still need to be submitted in the Chrome Web Store dashboard; editing this file does not publish them.

## Description

Create X Article drafts from Markdown, with your images in place.

Article Studio X companion connects the editor at md2xarticle.com to X Articles. Prepare your article on the website, review the complete handoff in the extension, then confirm creation. The companion opens X Articles automatically and continues using your signed-in X session.

- Import or paste Markdown and preview the article as you write.
- Attach an image folder once. The companion uploads and places the prepared images in document order.
- Render Mermaid diagrams to PNG automatically.
- Keep native tables or render tables as images for consistent layout.
- Review the article title, body, and prepared images before anything is uploaded to X.
- Recover from failed uploads and check uncertain results before retrying.

How to use:
1. Install the extension and open md2xarticle.com.
2. Paste Markdown or choose Example to try the included sample.
3. Attach any missing image files and check the preview.
4. Choose Create X draft in Article Studio, then confirm in the extension's review page. X Articles opens automatically if needed. If asked, sign in there and retry from the review page.
5. Review and publish the resulting draft in X.

The website works without an Article Studio account. Creating X drafts requires an X account with access to Articles. The extension creates drafts; publishing happens in X. It uses X's web editor interfaces, which may change.

Markdown and images are prepared locally in your browser. The extension sends the article and images directly to X only after your confirmation. It uses the existing session in your X tab and does not ask for your password. The companion does not include advertising or analytics tracking. The website collects visit statistics separately, as explained at md2xarticle.com/privacy.

Article Studio is independent and is not affiliated with or endorsed by X Corp.

Website: https://md2xarticle.com/
Support: https://md2xarticle.com/support
Privacy: https://md2xarticle.com/privacy

## Single purpose

Create an X Article draft, including its prepared images, from a Markdown article explicitly handed off by the user at md2xarticle.com. The extension reviews the handoff and uploads it to the user's existing X Articles session only after confirmation.

## Permission justifications

scripting: Injects the packaged x-runner.js into a loaded x.com/compose/articles tab after the user confirms Create X draft. The extension reuses an existing tab or opens one automatically. The runner uploads the prepared images and creates the article draft using that tab's X session. All executable code is bundled in the extension.

Host permissions: https://md2xarticle.com/* allows the content script to receive a user-initiated article handoff from this exact website. https://x.com/compose/articles* allows the extension to locate the user's X Articles tab and run the bundled draft client there. No content scripts run on unrelated sites. There is no all-sites, tabs, cookies, or upload-host permission.

Remote code: No. All JavaScript is included in the extension. X operation IDs are data read from resource timing or bundled fallback constants; no remote executable code is downloaded or evaluated.

Data disclosures: Website content (article title, body, images and associated file names); authentication information (X anti-forgery token and existing X session used only within the X tab to authenticate the requested operation). No sale, unrelated use, advertising, credit/lending use, or general browsing tracking.

## Reviewer instructions

Prepared for the 0.1.1 reviewer field (not yet submitted):

> Open https://md2xarticle.com/ > Example > Load example. Wait for preview, then Create X draft: review title, body and 2 images; no upload yet. Confirm to automatically open X Articles and create a draft. Use your own X account with Articles access. If asked, sign in in the X tab and retry from the review. Publishing is separate in X. Discard deletes the local staged job. No Article Studio login needed. Toolbar icon opens the website.

Full workflow for reference:

No Article Studio login or developer-managed service account is required.

1. Install the submitted extension, open https://md2xarticle.com/, and refresh the page if it was already open.
2. Click Example, then Load example. It contains text, a local sample image, a table, and a Mermaid flowchart. Wait for the preview to finish.
3. Click Create X draft in the website. The extension-owned review page opens with the title "A calmer way to publish", the prepared article body, and two image thumbnails. This step performs no X upload.
4. With no X Articles tab open, click Create X draft in the review. The extension opens https://x.com/compose/articles automatically and waits for it to load. If signed out, the X tab is focused and the review asks you to sign in before retrying. Discard staged article deletes the local staged job.
5. To test actual draft creation, use a reviewer-controlled X account with Articles access in the same Chrome profile. X controls account/subscription eligibility; we do not provide or operate X accounts. Repeat steps 2-3 and confirm Create X draft. No pre-opened X tab is required. This uploads the image assets and creates an unpublished X Article. Open the result in X to inspect the text, native table and image order. Publishing is a separate action in X.
6. Clicking the extension toolbar icon opens md2xarticle.com.

The extension uses a packaged @kaitox/x-article client in the X tab's MAIN world. It uses the page's X session, reads ct0 locally, and sends requests directly to X. It does not export credentials to the website or a developer server. X's private editor operation IDs can change, so X integration availability is subject to X's current service.

## Assets and package

- Icon: ../icons/icon-128.png (derived from the website's public/logo.png)
- Screenshots: screenshot-editor.png, screenshot-review.png (1280 × 800)
- Small promotional tile: small-promo.png (440 × 280)
- Package: article-studio-0.1.1.zip, generated by pnpm build:store
- Store build output: ../../dist-extension-store/, production origin only
- Development builds retain the localhost origins; do not upload their ZIP.

## Submission validation (September 16, 2026)

- `pnpm test`: 47 passing tests; type checks, production build, and store build passed.
- Production-only store extension loaded in isolated Chromium against the live website. Bridge handoff, two-asset review, idempotent staging, missing-X-tab preflight, and discard passed.
- A locally intercepted X tab was found with the reduced permissions. The packaged MAIN-world runner blocked creation when authentication was absent. These checks made no requests to X's service and did not create an actual X draft.
- Deployed privacy and support pages returned HTTP 200. Cloudflare's build for `5630055` succeeded.
- Google accepted the ZIP and all required listing fields. Privacy disclosures were checked after saving. The user verified the publisher contact email before submission.
- The isolated `md2x-store-test` browser was closed after the original submission verification. Public availability was subsequently verified on September 19; live X draft creation remains unverified.

