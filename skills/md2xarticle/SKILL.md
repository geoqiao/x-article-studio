---
name: md2xarticle
description: Turn a finished Markdown article into an X (Twitter) Article draft in one step through md2xarticle.com and its Chrome companion — checks the Markdown locally, attaches its local images and cover, and creates the draft in the user's signed-in X account. Use when the user asks to publish, post, upload or draft a Markdown article to X Articles.
---

# Markdown → X Article draft

The user writes the article; this skill does the rest and ends with a draft URL. It never publishes: publishing stays a manual step in X. It never edits the user's files: conversions go to a temporary copy.

Requirements: `node` 20+, `playwright-cli`, Chrome with the Playwright Extension, the [Article Studio X companion](https://chromewebstore.google.com/detail/ojpjldmiiibgjnbjfiacaoenfgpdhbbh) installed, and an X account with Articles access signed in.

## Steps

1. Check the article, resolve its images, and generate the browser scripts:

   ```bash
   node <skill-dir>/scripts/prepare.mjs /path/to/article.md [--images <attachments folder>] [--cover <image>] [--endnotes] [--flatten-lists] [--allow-wikilinks]
   ```

   It prints JSON and runs the website's own content checks without opening a browser. Exit code 1 means `problems` is non-empty: fix each one (see below) and run it again. On success `create` and `wait` are script paths. Read `warnings` and `notes` too; mention anything that affects the result (no cover, downscaled images, wikilinks) in the final report.

2. Open a tab in the user's Chrome and run the script:

   ```bash
   playwright-cli attach --extension=chrome --session=md2x-<timestamp>
   playwright-cli -s=md2x-<timestamp> run-code --filename=<create>
   ```

3. Act on the returned object:

   | Result | Meaning and next action |
   | --- | --- |
   | `ok: true` | Draft created. Give the user `draftUrl`. Pass on `message` if it mentions the cover. |
   | `stage: "awaiting-confirmation"` | The companion's review tab is open and waiting. Ask the user to click **Create X draft** there, and to tick **Create drafts without this review** so later runs need no click. Then run `<wait>` the same way. |
   | `stage: "issues"` | The website found content the converter would lose that step 1 did not catch (usually an image that failed to load). `issues` lists them with line numbers. Fix with the user's agreement and start again from step 1. |
   | `stage: "failed"` | Nothing was created; `message` says why. `errorCode: "X_FIREWALL_BLOCKED"` means X's firewall refused the text — in practice a command piped into a shell such as `curl … \| sh`; step 1 already warns about such lines. Reword that text with the user's agreement and start again. Sign-in problems: ask the user to sign in to X, then start again. |
   | `stage: "uncertain"` | X gave no clear answer. Do not retry. Ask the user to check x.com/compose/articles and resolve it in the companion review. |
   | `stage: "cover"` | The cover could not be prepared; `detail` says why. `cover: "unsupported-site"` means the site predates cover support. |
   | `stage: "companion-missing"` | Ask the user to install the companion and reload the page. |
   | `stage: "companion-outdated"` | Companion older than 0.1.2: it opened its review but reports nothing back and sets no cover. Ask the user to confirm there and check X. |

4. Close the tab: `playwright-cli -s=md2x-<timestamp> tab-close`.

## Fixing `problems`

Each problem names a line or a file. Prefer the lossless flags over editing text:

- `nested-list` → re-run with `--flatten-lists` (simple nested lists become one level; complex ones still need editing).
- `footnote` → re-run with `--endnotes` (references become `[n]`, notes move to the end after a divider).
- Image not found → pass `--images <folder>`: the folder is searched by path suffix, then by file name. Obsidian embeds like `![[shot.png]]` are supported; the attachments folder is where Obsidian stores them.
- Raw HTML, images inside lists, quotes or tables, relative links → edit the Markdown with the user's agreement.
- Wrong format or over 40 MiB → convert or shrink into a temporary copy (macOS: `sips -s format png in.gif --out out.png`, `sips -Z 2400 in.png --out out.png`) and point a temporary copy of the Markdown at it. SVG and images between 5 and 40 MiB need nothing: the website converts and downscales them.

## Images and cover

- Body images: local paths are resolved relative to the article, then searched under the article folder and `--images`. Remote `https` images are downloaded by `prepare.mjs` into a temporary folder, so the host's CORS policy does not matter.
- Cover, first match wins: `--cover`, frontmatter `cover: path`, a `cover.png|jpg|jpeg|webp` beside the article. With none of these, `coverCandidates` lists files whose name contains "cover" in the folders that hold the article's own images. Never pick one silently: show the candidates to the user, ask which to use (or none), then re-run with `--cover <path>`. If there is still no cover, say so in the final report. X shows covers at about 5:2.

## Boundaries

- The session only sees the tab it opened. It cannot click the companion review or change its settings; that one-time tick is the user's.
- `warnings` are not blockers (inline code styling, task lists, wikilinks, shell pipes, downscaled images). Report them; do not rewrite the article to silence them unless the user asks.
- Do not retry a run that returned `uncertain`, and do not run `create` twice for one article without checking the first result: each run creates a separate draft.
- `scripts/studio-core.mjs` is generated from the website's source by `pnpm build:skill`; do not edit it by hand.
