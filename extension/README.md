# Article Studio X companion

This Manifest V3 extension connects Article Studio to X's article editor.
The app content script accepts only request-ID messages from the exact app origin and
stores no X session data. A received bundle is kept in extension IndexedDB and opened
in an extension-owned review page. The X request starts only when **Create X draft**
is clicked there.

The build includes `http://localhost:4318` and `http://127.0.0.1:4318`. Set
`ARTICLE_STUDIO_ORIGIN=https://md2xarticle.com` while running
`pnpm build:extension` to add one exact deployment origin. Wildcards, paths, and
non-HTTP origins are rejected.

`pnpm build:production` and `pnpm run deploy` include the production origin automatically.
After rebuilding, reload the unpacked extension at `chrome://extensions`, then
refresh the app. Chrome Web Store publication is a separate step.

The handoff validator accepts a non-empty title up to 2,000 characters and
Markdown up to 200,000 characters. It allows at most 40 PNG, JPEG, or WebP
assets, with a 5 MiB decoded limit per asset and 20 MiB decoded in total. Each
declared SHA-256 is checked before the bundle is staged and checked again before
the X runner uses it.

The review page looks for an existing signed-in
`https://x.com/compose/articles` tab. The runner is injected into that tab's MAIN
world and uses `@kaitox/x-article@0.6.0` with the page's own cookies. It uploads
every bundled image before calling `ArticleEntityDraftCreate`; an asset failure
prevents draft creation. It never calls a publish mutation. If the create request
has an uncertain result, the job is held until the user checks X and explicitly
allows another attempt.

Load `dist-extension/` as an unpacked extension in Chrome. The same build writes
`public/article-studio-bridge.zip`, which the web app can serve as its download.
