# Article Studio

Status: **prototype** · Started: **2026-09-15**

Live app: <https://md2xarticle.com> · Private repository: <https://github.com/geoqiao/x-article-studio>

A Markdown-to-X-Articles web app inspired by MD2X’s editing workflow and built on Kaitox’s MIT-licensed article converter. It prepares ordinary images, renders Mermaid to PNG, preserves native tables (or renders them to PNG), and passes a complete document to a small Chromium companion.

**The local editor and exports work. The companion is implemented, but creating and rendering a draft in a real X account has not been verified.** X’s private editor interfaces and account access remain the live integration boundary.

## Run locally

Requires Node 22.12+ and pnpm 11. This project has its own dependency lockfile and workspace boundary.

```sh
git clone https://github.com/geoqiao/x-article-studio.git
cd x-article-studio
pnpm install --frozen-lockfile
pnpm build:extension
pnpm dev
```

Open <http://127.0.0.1:4318>. No backend, API key, paid image generator, or relay server is needed. Rendering and saved drafts use the browser. Fonts are self-hosted.

1. Paste Markdown into the left editor, use **Import Markdown**, or drop a `.md`/`.markdown` file into the editor. The first H1 becomes the title.
2. The preview updates automatically, including Mermaid and attached images. Add pictures through **Images**, or paste/drop them into the editor. For local Markdown (including Obsidian), use **Match image folder** once: choose the image folder or its parent. Only referenced images are attached; the Markdown stays unchanged. Individual files also match longer relative paths when their filenames are unambiguous.
3. Use the **Tables** selector above the preview to keep native tables or render PNGs. The **Table** and **Diagram** toolbar buttons insert examples at the cursor.
4. **Copy title** copies the separate title. **Copy body** copies formatted rich text with X's two heading levels, emphasis, links, lists, and quotes. Use regular Paste in the X Articles body field. Plain-text applications receive readable prose, with list markers and link destinations. If clipboard permissions are blocked, selection copying is tried automatically; the final fallback lets you select and copy the formatted body. Copy individual PNGs from **Images** at the image markers; clipboard pasting does not automatically upload images or guarantee native table preservation.
5. **Create X draft** uses the companion to upload and place all images automatically. It first opens the companion’s review; confirmation there starts the X write. Publishing remains separate.

Missing files and unsupported constructs show an action beside the preview. There is no manual preparation step. **Export ZIP** remains available for portable Markdown and images, and **Save Markdown** downloads the original source. **How to use** contains a short guide, an optional title override, and the test/limitation notes.

Every ordinary image or missing-image placeholder has **Replace image / Choose image** directly beneath it. After a replacement, **Undo change** restores the previous choice (one step per image during the current session). **Fix image** still opens its card in the Images drawer. Image choices persist across reloads; undo history does not. Changing a shared image source updates all its occurrences.

**Import Markdown starts a fresh article**, including when selecting the same file again. Previous attachments, manual image replacements, undo, and rendered previews are cleared. Select **Match image folder** again for that import, or drop the Markdown and its images together. Refreshing the page resumes the current saved draft with its selected images; it does not perform a new import.

Relative paths are valid; importing a `.md` file simply does not grant the website access to neighboring local files. You do not need to rewrite paths as absolute paths. Folder matching works with the innermost image folder, `assets`, or a parent folder. It prefers matching directory suffixes and asks for a specific file when names are ambiguous. Selecting the correct folder also repairs earlier incorrect replacements.

## Standalone HTML preview

Open [article-studio-preview.html](article-studio-preview.html) directly in a Chromium browser. It is the actual editor bundled into one file (about 4.5 MiB), including JavaScript, CSS, fonts, Mermaid, and license notices. No server or CDN is required for local editing, image preparation, rendering, or ZIP export. The example renders automatically on opening.

To regenerate it after a source change, run `pnpm build:html`. The generated HTML is ignored by Git. Remote images still need network access and CORS permission. Browser policies determine whether drafts persist from local files; ZIP export provides a portable backup. X handoff is available through the full app and companion, not the standalone file.

Test-coverage notes are under **How to use**. Main browser workflows were tested in Chrome, including offline rendering; live X behavior and exhaustive format/browser coverage remain unverified.

## Connect the companion

Build with `pnpm build:extension`, then open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `dist-extension/`. The app also offers the generated `article-studio-bridge.zip`; extract it before loading.

Open a signed-in <https://x.com/compose/articles> tab and refresh Article Studio. The default development build accepts `http://127.0.0.1:4318` and `http://localhost:4318`. Production builds also accept `https://md2xarticle.com`. These are separate browser storage origins; drafts and attachments do not automatically move between them.

The web page can stage a bundle and query connection status. Draft creation requires the extension’s review action. Images upload sequentially; their returned media IDs are inserted at the corresponding document positions. Any image failure prevents draft creation. An ambiguous create result requires checking X before another attempt. A retry may re-upload images already uploaded by a previous failed attempt.

See [extension instructions](extension/README.md) and [architecture](docs/architecture.md).

## Format support

| Input | Treatment |
| --- | --- |
| Local PNG/JPEG/WebP | Attach once; companion uploads and places body images automatically |
| Remote images | Download in browser, then upload; CORS restrictions require a local replacement |
| GFM tables | Native X Markdown entity; optional automatic PNG conversion |
| Standalone Mermaid fences | Local SVG → PNG; companion uploads and places the result |
| Paragraphs, emphasis, links, simple lists, quotes, dividers | Native article blocks and formatting |
| Fenced code | Native Markdown entity; highlighting depends on X |
| H1/H2/H3 | Title plus two body heading levels |
| H4–H6, inline code, task checkboxes | Reduced heading depth / lost monospace or checkbox state, with warnings |
| Nested lists, raw HTML, footnotes, nested images/diagrams | Blocked where the converter would lose content |
| Math, covers, ALT descriptions, GIF/SVG/video | Not implemented by this prototype; set or convert separately |

The distinction between X platform capabilities and this bridge’s limitations matters. For example, **X’s official API documents LaTeX and native tables**. This prototype implements tables through Kaitox’s private adapter, but not LaTeX. See the [complete compatibility matrix and sources](docs/compatibility.md).

## Limits and storage

- Up to 200,000 Markdown characters, a 2,000-character single-line title, 40 prepared assets, 5 MiB per image, and 20 MiB total. These are prototype limits, not a statement of all X limits.
- Native code/table source has a conservative 10,000-character preflight budget. X documents a weighted Markdown budget; the app’s raw-character check is an approximation, and X remains authoritative.
- Table PNGs support up to 10 columns and 150 rows within canvas size limits. Split large tables and check readability on a phone.
- Mermaid is static in X. Its editable source remains in the locally saved draft. ZIP Markdown references the prepared PNG.
- Public image fetches omit cookies, reject redirects, and need CORS permission. Private or login-protected URLs should be downloaded and attached locally.
- The current draft and attachments persist in IndexedDB. **Load example** replaces them. ZIP export is a portable backup; it is not ZIP import support.
- Staged bundles persist separately in extension IndexedDB until discarded or completed. The extension retains result metadata after completion to avoid repeating the same job.

## Build and deployment

```sh
pnpm check
pnpm test
pnpm build
```

`dist/` is the static web app. `dist-extension/` is the unpacked companion. `public/article-studio-bridge.zip` is generated before Vite copies public assets into the web build.

The production app at <https://md2xarticle.com> is served by Cloudflare Workers Static Assets. Cloudflare Workers Builds deploys pushes to the private repository's `main` branch with these settings:

| Setting | Value |
| --- | --- |
| Worker name | `md2xarticle` |
| Repository root | `/` |
| Production branch | `main` |
| Non-production branch builds | Disabled |
| Build command | `pnpm test && pnpm build:production` |
| Deploy command | `pnpm run deploy` |
| Build variable | `PNPM_VERSION=11.5.0` |
| Node version | `.node-version` |

The build runs tests and TypeScript checks, creates the companion for the exact production origin, and bundles the static web app. Cloudflare's Git integration supplies deployment credentials; no credentials belong in this repository. The domain and asset directory are declared in `wrangler.jsonc`. HTML and the companion ZIP are revalidated on each request; only content-hashed assets get long-lived browser caching.

Cloudflare manages the custom domain's DNS and TLS certificate. The zone's **Always Use HTTPS** setting is enabled, redirecting HTTP requests while preserving paths and query strings. This zone setting is managed separately from Wrangler. Monitor deployments and build logs in the [Cloudflare project dashboard](https://dash.cloudflare.com/4c7b6a86dbcbd91469298d396009cccf/workers/services/view/md2xarticle/production).

For local production verification or an authenticated manual deployment:

```sh
pnpm build:production
pnpm run deploy --dry-run
# After wrangler login, when a manual deployment is needed:
pnpm run deploy
```

Use `pnpm run deploy` explicitly: `pnpm deploy` is pnpm's separate workspace-packaging command. The production build supplies `ARTICLE_STUDIO_ORIGIN` from the shell; `.env.example` is documentation, not an automatically loaded configuration file. Reload the unpacked extension after rebuilding and refresh the web app to use the new origin. Chrome Web Store publication is separate and has not been performed.

The public app serves code and fonts; Markdown parsing, image preparation, and saved drafts stay in the browser. Opening a remote image URL still makes a request to its host. Only the companion's confirmed review action sends prepared article content to X.

## Implementation and evidence

The monochrome X-and-article-lines logo is available as [SVG](public/logo.svg) and [512-pixel PNG](public/logo.png). The header and favicon share the SVG; the standalone preview embeds it.

- [How Kaitox works and what this app changes](docs/architecture.md)
- [Syntax support, restrictions, and primary sources](docs/compatibility.md)
- [Verification record](docs/verification.md)
- [Third-party licenses](public/THIRD_PARTY_NOTICES.txt)

Core packages are pinned to `@kaitox/x-article@0.6.0`, `marked@18.0.5`, and `mermaid@11.16.0`. Kaitox’s repository, npm release, and browser-store release are distinct artifacts; this project uses the npm converter/client, not its full extension or branding.
