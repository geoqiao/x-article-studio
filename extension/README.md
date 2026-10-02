# Article Studio X companion

This Manifest V3 extension connects Article Studio to X's article editor (Chrome 116+).
The app content script accepts only request-ID messages from the exact app origin and
stores no X session data. A received bundle is kept in extension IndexedDB and opened
in an extension-owned review page. The X request starts when **Create X draft**
is clicked there. From 0.1.2 the review page (also the extension's options page)
has an opt-in **Create drafts without this review** setting; while it is on, staging
from the website starts creation directly and a failed or uncertain attempt opens
the review. Only extension pages can change the setting.

The build includes `http://localhost:4318` and `http://127.0.0.1:4318`. Set
`ARTICLE_STUDIO_ORIGIN=https://md2xarticle.com` while running
`pnpm build:extension` to add one exact deployment origin. Wildcards, paths, and
non-HTTP origins are rejected.

`pnpm build:production` and `pnpm run deploy` include the production origin automatically.
After rebuilding, reload the unpacked extension at `chrome://extensions`, then
refresh the app. Chrome Web Store publication is a separate step.

For Chrome Web Store, run `pnpm build:store`. This creates
`dist-extension-store/` and `extension/store/article-studio-<version>.zip`, restricted
to `https://md2xarticle.com` and the X article editor, without localhost access.
The store package uses only `scripting` plus these host permissions. Tab lookup
uses the matching host grants; it does not need the broader `tabs` permission.
Review-page reuse uses `runtime.getContexts`, available since Chrome 116, because
tab queries without the broader permission hide extension-page URLs.
Media requests run inside the X page, so no upload-host grant is required.
Clicking the toolbar icon opens Article Studio. The icons are resized from the
website's `public/logo.png`; the same mark appears on the review page.

Store listing and reviewer instructions: [store/listing.md](store/listing.md).
Privacy policy: <https://md2xarticle.com/privacy>.

The handoff validator accepts a non-empty title up to 2,000 characters and
Markdown up to 200,000 characters. It allows at most 40 PNG, JPEG, or WebP
assets, with a 5 MiB decoded limit per asset and 20 MiB decoded in total. Each
declared SHA-256 is checked before the bundle is staged and checked again before
the X runner uses it.

After confirmation in the review page, version 0.1.1 reuses an existing
`https://x.com/compose/articles` tab or opens it automatically in the background.
It waits up to 30 seconds for navigation to finish before starting the runner.
Signed-in users need no extra click. A login redirect, absent session, closed tab
or loading timeout stops the attempt before draft creation; the X tab is focused
when available so the user can resolve the issue and retry. Articles eligibility
remains controlled by X. The runner is injected into that tab's MAIN
world and uses `@kaitox/x-article@0.6.0` with the page's own cookies. It uploads
every bundled image before calling `ArticleEntityDraftCreate`; an asset failure
prevents draft creation. It never calls a publish mutation. From 0.1.2 an optional
cover uploads with the images and is set with `ArticleEntityUpdateCoverMedia` after
creation; a refused cover leaves the draft in place with a warning. A 4xx answer to
the create request (X's firewall, authentication, rate limit) is a definite refusal
and can be retried. If the create request has an uncertain result, the job is held
until the user checks X and explicitly allows another attempt.

Load `dist-extension/` as an unpacked extension in Chrome. The same build writes
`public/article-studio-bridge.zip`, which the web app can serve as its download.
