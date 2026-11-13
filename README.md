# Early Performance Optimizer

A configurable Manifest V3 browser extension with local settings. Its optimizations are best-effort and can affect page behavior. There are no guaranteed performance gains.

## Features and limitations

- Best-effort native lazy loading for offscreen images and iframes after the content script starts. Explicit loading attributes and recognized site-managed lazy-loading metadata are preserved. Already-started fetches cannot be deferred retroactively.
- Image hints: asynchronous decoding and low fetch priority for eligible offscreen images, without rewriting `src` or `srcset`. Explicit attributes are preserved.
- Reduced animation and transition durations while retaining events and final keyframes, without revealing hidden elements.
- Optional resource hints: preconnect and DNS-prefetch for at most six external HTTP(S) origins, excluding known blocked ad domains when blocking is enabled. Deferred media and iframe origins are not speculatively contacted. Existing preload priorities are not demoted.
- Opt-in viewport rendering for elements carrying the `.optimize-viewport` class, controlled by image optimization. This does not automatically hide arbitrary page content.
- Basic ad-domain blocking for third-party subresources from `doubleclick.net`, `googlesyndication.com`, and `googleadservices.com`, using declarative network request rules. Main-frame navigation is not blocked. This is not a comprehensive ad blocker and will not block every ad or tracker.
- Optional `Save-Data: on` request header. Websites may ignore it, and it is not a bandwidth guarantee.
- A master toggle and individual settings in the popup, with live storage updates across content-script frames and tabs. Disabling features restores extension-managed DOM changes where possible and stops future applicable network rules. Already-loaded resources, completed requests, and page-side effects cannot be undone. Reload a page for a clean baseline.
- No script deferral, source rewriting, or preload demotion is performed. Browser-controlled loading and page scripts may limit what the extension can change safely.

## Reproducible builds

Use **Node.js 20 or newer** and npm. Builds and unit tests need no package installation, third-party runtime dependencies, or system ZIP command. The optional installed-extension acceptance suite uses Playwright as a development dependency only.

```sh
npm run build          # both targets
npm run build:chrome   # Chrome only
npm run build:firefox  # Firefox only
npm test              # Node test runner, including real npm CLI packaging tests
```

To run the actual Chrome extension in an isolated browser profile:

```sh
npm ci
npx playwright install chromium
npm run test:browser
```

The acceptance suite loads `build/chrome`, clicks the popup's visible switches, exercises content scripts in the main document and an iframe, and verifies actual HTTP Save-Data headers and ad blocking against a local server. It creates and removes a disposable profile and does not attach to a personal browser. No external ad server is contacted. To use an existing compatible Chromium build, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable path. Firefox runtime testing remains a separate manual check.

Canonical extension sources live at the repository root. Builds copy referenced assets, including shared `settings.js`, content scripts, and popup assets, into:

| Target | Unpacked extension | Archive |
| --- | --- | --- |
| Chrome | `build/chrome/` | `dist/chrome-extension.zip` |
| Firefox | `build/firefox/` | `dist/firefox-extension.zip` |

Each build replaces its target directory and ZIP, removing stale target files. Single-target commands leave the other target alone. The builder excludes browser-generated `_metadata` and does not edit or delete tracked metadata. `build/`, `dist/`, and local generated metadata are ignored by Git.

Archives contain sorted paths, fixed ZIP timestamps, and uncompressed entries with CRC checksums. Identical source bytes produce identical archive bytes without relying on local file timestamps or ZIP tool versions. ZIPs are slightly larger than compressed packages. The Chrome manifest is copied byte-for-byte. Firefox remains MV3 but uses `background.scripts` (`settings.js`, then `background.js`) instead of a service worker, plus a stable Gecko ID and Firefox 128 minimum for the DNR target.

## Load a development build

### Chrome

1. Run `npm run build:chrome`.
2. Open `chrome://extensions/` and enable **Developer mode**.
3. Choose **Load unpacked** and select **`build/chrome`**, not the repository root.
4. After rebuilding, reload the extension and refresh test pages.

The ZIP is a distribution artifact, not an instruction to drag an unsigned ZIP into Chrome.

### Firefox

1. Use Firefox **128 or newer** and run `npm run build:firefox`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Choose **Load Temporary Add-on…** and select **`build/firefox/manifest.json`**.
4. After rebuilding, reload the temporary add-on and refresh test pages.

Temporary add-ons are removed when Firefox restarts. The generated ZIP is **unsigned** and is not a permanently installable Firefox release. Permanent distribution normally requires Mozilla signing. The Gecko ID is a development identity, not a store listing or signing approval.

## Validation scope

`npm test` exercises settings normalization, update preservation, network-rule reconciliation, popup write races and error recovery, plus actual npm build commands in an isolated copy. Packaging checks inspect ZIP headers and checksums, compare packaged bytes with canonical source files, verify required assets and browser manifest differences, reject stale files, and check repeated-build determinism. These unit and packaging checks alone do not establish browser runtime behavior.

`npm run test:browser` separately exercises the installed Chrome extension, including image source preservation, more than ten images, dynamic content, viewport targets, iframe navigation, live settings, conditional DOM rollback, master disabling and bounded network rules. It checks network behavior in a real Chromium engine rather than mocking the extension APIs. This does not establish performance improvements or compatibility with every site. Manually check Firefox and representative real sites before distributing a release. No browser-store availability or successful Firefox runtime test is implied.

### Regression coverage

| Previously reported problem | Check |
| --- | --- |
| Image batches addressed the wrong image | Installed browser: 12 incomplete images retain their exact sources and responsive source set, with the last image optimized |
| Master switch left background behavior active | Installed browser: disabled popup removes all rules and DOM changes, including frames and subsequent navigations |
| Individual settings ignored | Installed browser: every DOM toggle rolls back live; request headers and ad requests follow their own toggles |
| Dynamic mutations never scheduled | Installed browser: inserted images, class changes, detached nodes, and committed iframe reloads |
| Save-Data rules accumulated and persisted after disabling | Installed browser: actual HTTP headers and bounded rule count after repeated navigation; unit tests cover all boolean combinations and queue recovery |
| Updates reset preferences | Unit test of actual installation/startup listeners preserves custom settings; installed browser restart retains disabled state and individual preferences |
| Frame commits targeted the top document | Content scripts run independently in all matching frames, with one style in each document, verified after iframe navigation |
| Duplicate or leaked observers | Unit tests hold storage reads across pagehide/pageshow and verify cancellation; installed browser checks history/reload and DOM rollback |
| Viewport observer had no targets | Installed browser: initial offscreen state, scrolling into view, and dynamic class removal |
| Lazy loading was invalid CSS | Installed browser: actual offscreen image/iframe HTML loading attributes, preserving existing site choices |
| Missing builds and mismatched release files | Actual npm CLI build tests compare every archive asset to canonical source and verify deterministic rebuilds and browser-specific manifests |

Synthetic unit tests are used for deterministic storage failures, update events, and callback races. They complement the installed-browser suite, not replace it. A real extension version upgrade and Firefox runtime behavior are not automated here.
