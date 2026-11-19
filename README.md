# LeadClean

Browser-only rebuild of the desktop Excel Data Processor — merges CSV/Excel lead
files and extracts clean, unique mobile numbers (or merges full rows), with a
column picker, a mobile-column picker, a join/lookup against a second file,
and split-by-rows or split-by-parts output. Everything runs inside the
visitor's own browser tab; no file is ever uploaded anywhere.

## Files

- `index.html` — the whole app (React, loaded from CDN, no build step).
- `utils.js` — the pure logic (mobile-number normalization, CSV parsing,
  header-mismatch grouping, split math). Has no dependency on the browser or
  React, so it can be unit-tested with plain `node`.

That's it — two files, no `npm install`, no bundler. Opening `index.html`
directly in a browser (`file://`) works too, except the "Download" button:
browsers block `file://` pages from creating downloads, so when testing
locally, serve the folder instead (see below) rather than double-clicking
the file.

## Open it in VS Code

1. Put `index.html` and `utils.js` in a new folder, e.g. `leadclean/`.
2. In VS Code: `File → Open Folder…` → pick that folder.
3. To preview it locally, don't just double-click `index.html`. Either:
   - install the **Live Server** extension, right-click `index.html` →
     "Open with Live Server", or
   - run `npx serve .` (or `python3 -m http.server 8080`) from a terminal in
     that folder, then open the printed `http://localhost:...` URL.

## Deploy to Cloudflare Pages

No build step is needed — this ships as a static site.

**Option A — dashboard (easiest, no CLI):**
1. Go to the Cloudflare dashboard → **Workers & Pages → Create → Pages →
   Upload assets**.
2. Drag in the `leadclean` folder (or a zip of its contents).
3. Framework preset: **None**. Build command: leave empty. Output directory: `/`.
4. Deploy — Cloudflare gives you a `*.pages.dev` URL immediately. Share that
   link with the team.

**Option B — Wrangler CLI (for repeat deploys from VS Code's terminal):**
```sh
npm install -g wrangler        # one-time
cd leadclean
wrangler pages deploy . --project-name=leadclean
```
First run will ask you to log in to Cloudflare in the browser and confirm the
project name — after that, re-running the same command pushes a new version.

Either way, every file change means re-uploading (dashboard) or re-running
`wrangler pages deploy .` (CLI) — there's no live auto-sync from VS Code.

## Updating the code

- Edit `index.html` for anything UI/behavior — it's one file, with the styles
  in a `<style>` block and the app itself in a `<script type="text/babel">`
  block (plain React, transpiled live by Babel in the browser — no build
  step, but also no type-checking, so test changes in a real browser before
  deploying).
- Edit `utils.js` for the pure logic, and check it with:
  ```sh
  node test_utils.js
  ```
  (if you don't have `test_utils.js`, ask for it again — it's the unit-test
  file used while building this, not required for the site to run).

## A few things worth knowing

- **File size**: built and tuned to handle lead files up to roughly 450MB —
  CSV uses noticeably less browser memory than the same data as XLSX, so
  prefer CSV for anything very large if you have the choice. This depends on
  the machine's free RAM and browser (Chrome handles large files best); it
  isn't a hard guarantee for every device.
- **Downloads**: on Cloudflare (or any normal web host) the "Download"
  button uses a plain browser download, same as any other site — no special
  setup needed.
- **Privacy**: nothing is uploaded. Parsing, de-duplication and file-building
  all happen in the visitor's own browser tab.
- **Libraries**: React, ReactDOM, Babel (for JSX) and SheetJS (`xlsx`, for
  reading `.xlsx`/`.xls`) load from public CDNs (cdnjs/unpkg) via `<script>`
  tags in `index.html`. If your team's network blocks those CDNs, the page
  will load blank — allow cdnjs.cloudflare.com and unpkg.com, or download
  those four scripts and point the `<script src>` tags at local copies
  instead.
