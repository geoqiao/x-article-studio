import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const result = await build({
  absWorkingDir: root,
  entryPoints: ["src/main.tsx"],
  outfile: "preview-bundle.js",
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "eof",
  define: {
    "process.env.NODE_ENV": '"production"',
    "import.meta.env.VITE_STANDALONE_PREVIEW": '"true"',
  },
  loader: { ".ttf": "dataurl", ".woff": "dataurl", ".woff2": "dataurl", ".svg": "dataurl" },
  plugins: [
    {
      name: "inline-public-fonts",
      setup(builder) {
        builder.onResolve({ filter: /^\/fonts\// }, ({ path }) => ({
          path: resolve(root, "public", path.slice(1)),
        }));
      },
    },
  ],
});

const js = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
const css = result.outputFiles.find((file) => file.path.endsWith(".css"))?.text;
if (!js || !css)
  throw new Error("The preview must contain both JavaScript and CSS.");
if (result.warnings.length)
  throw new Error(
    "Resolve bundle warnings before distributing a standalone preview.",
  );

const escapeHtml = (text) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const notices = await readFile(
  resolve(root, "public/THIRD_PARTY_NOTICES.txt"),
  "utf8",
);
const favicon = Buffer.from(
  await readFile(resolve(root, "public/logo.svg")),
).toString("base64");
const html = `<!doctype html>
<html lang="en" data-preview="standalone">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#f5f4ef">
  <title>Article Studio · Standalone preview</title>
  <link rel="icon" href="data:image/svg+xml;base64,${favicon}">
  <style>${css.replace(/<\/style/gi, "<\\/style")}</style>
</head>
<body>
  <div id="root"></div>
  <noscript>Enable JavaScript to use the Markdown editor and local image rendering.</noscript>
  <template id="third-party-notices">${escapeHtml(notices)}</template>
  <script>${js.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>
`;
const output = resolve(root, "article-studio-preview.html");
await writeFile(output, html);
console.log(
  `Created article-studio-preview.html (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MiB). Open it directly in a browser; no server or CDN is required.`,
);
