# Companion 0.1.1 — automatic X Articles tab

Date: September 19, 2026. Status: implementation and local verification complete; store submission is tracked in `extension/store/listing.md`.

After the user confirms **Create X draft** in the companion review, the extension reuses an existing X Articles tab or opens one in the background. It waits for navigation to finish, then continues with the existing runner and X session. The website no longer lists manually opening X as a setup step; an older-version fallback link remains while the store update rolls out.

Login redirects, missing session, tab closure and a 30-second loading timeout stop before creation and provide recovery instructions. Where possible, the X tab is focused for sign-in. A signed-in account still needs Articles access. Existing protection against duplicate draft attempts and retries after uncertain results remains in place; publishing is still a separate action in X.

The browser check also exposed duplicate review tabs: without the broad `tabs` permission, Chrome hides extension-page URLs from `tabs.query`. Review reuse now uses `runtime.getContexts`, with Chrome 116 declared as the minimum. No additional permissions were added.

## Verification

- 68 unit tests across 8 files passed, including loading, tab reuse, redirects, timeout, closure and missing authentication.
- TypeScript checks, production website build and the production-only 0.1.1 store package passed.
- The real unpacked extension and packaged MAIN-world runner passed the browser handoff against a local HTTPS X fixture: two image uploads, exactly one draft per confirmed job, no X navigation before review confirmation, automatic tab opening, signed-out preflight, retry reusing the same tab, and a signed-in fixture completing on the first confirmation without an existing X tab.
- Repeated staging reused a single extension review. Completed jobs were deleted through the review UI.
- The final fixture browser mapped X/upload hosts to localhost and blocked other external DNS. It made no requests to the real X service. An earlier isolated signed-out diagnostic opened the real X page because Chrome begins extension-created navigation before Playwright request interception attaches; it stopped at missing authentication without uploads or draft creation. The fixture setup now covers that first navigation too.

Real-account X draft creation and rendering remain unverified. Local fixtures establish extension orchestration and client integration, not current X private API compatibility.
