# Publishing MD Editor Plus

This extension ships to two marketplaces:

- **Visual Studio Marketplace** — the default Marketplace inside VS Code. Required if you want users in stock VS Code to install via the Extensions panel.
- **Open VSX Registry** — covers Cursor, VSCodium, Gitpod, Theia, code-server, and any non-Microsoft VS Code derivative. Same `.vsix`, different upload.

Both publish from the same codebase via npm scripts already in `package.json`.

---

## One-time setup

You need two accounts and two tokens. Each takes ~5 minutes.

### 1. Visual Studio Marketplace (publisher: `AviranRevach`)

1. Open https://marketplace.visualstudio.com/manage and sign in with a Microsoft account.
2. Create a new publisher with the **ID** `AviranRevach` (must match `package.json`).
3. Generate a Personal Access Token (PAT):
   - Open https://dev.azure.com → User Settings → **Personal Access Tokens**.
   - **Organization:** All accessible organizations.
   - **Scopes:** click "Show all scopes", then check **Marketplace → Manage**.
   - **Expiration:** 1 year is fine.
4. Copy the token — you only see it once.
5. Authenticate `vsce` once:
   ```sh
   npx vsce login AviranRevach
   ```
   Paste the PAT when prompted. Stored locally; you don't need to re-login until it expires.

### 2. Open VSX Registry

1. Open https://open-vsx.org and click **Sign In** (uses your GitHub account).
2. Accept the publisher agreement when prompted.
3. Generate a token at https://open-vsx.org/user-settings/tokens → "Generate new token".
4. Copy it (also one-time view).
5. Either export it before publishing or pass it inline:
   ```sh
   export OVSX_PAT=<your-token>
   ```
   `ovsx` reads this env var automatically.

---

## Automated publishing (GitHub Actions)

`.github/workflows/publish.yml` publishes to both marketplaces on every merge to `main` that touches `src/`, `media/`, `esbuild.config.js`, `package.json` or `package-lock.json`. It runs tests, bumps the patch version, publishes, then commits the bump and tag back to `main` with `[skip ci]` and creates a GitHub release (auto-generated notes from the merged PRs, `.vsix` attached). It needs the repo secrets `VSCE_PAT` and `OVSX_PAT` (tokens from the setup above). For a minor or major release, bump the version manually in your PR; the workflow still adds a patch on top.

---

## Publishing flow (every release, manual)

1. **Bump the version** in `package.json` (semver: patch/minor/major).
   ```sh
   npm version patch   # or: minor, major
   ```
   This commits and tags the version in git.

2. **Update `CHANGELOG.md`** with the new version's changes.

3. **Build a clean .vsix** to verify what ships:
   ```sh
   npm run package
   ```
   Inspect the file list it prints. The bundle should be ~630 KB and contain:
   - `dist/extension.js`, `dist/mdEditorPlusProvider.js`, `dist/webview.js`
   - `media/icon.png`, `media/MD-editor-plus.png`
   - `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE.txt`

4. **Publish to VS Code Marketplace:**
   ```sh
   npm run publish:vscode
   ```
   Listing appears at: https://marketplace.visualstudio.com/items?itemName=AviranRevach.md-editor-plus

5. **Publish to Open VSX:**
   ```sh
   npm run publish:openvsx
   ```
   Listing appears at: https://open-vsx.org/extension/AviranRevach/md-editor-plus

6. **Push git tags:**
   ```sh
   git push --follow-tags
   ```

---

## Troubleshooting

- **`vsce publish` fails with 401** — your PAT expired or doesn't have Marketplace (Manage) scope. Generate a new one.
- **`ovsx publish` fails with 403** — make sure you accepted the Open VSX publisher agreement and that `OVSX_PAT` is set.
- **Bundle is huge** — re-check `.vscodeignore`. Sourcemaps must be excluded by `**/*.map` (single `*.map` only matches root-level files).
- **Stale files in `dist/`** — delete `dist/` and re-run `npm run compile` if you renamed source files.

---

## Quick reference

```sh
# First-time only
npx vsce login AviranRevach
export OVSX_PAT=<token>

# Every release
npm version patch
npm run package          # verify the .vsix
npm run publish:vscode   # → VS Code Marketplace
npm run publish:openvsx  # → Open VSX Registry
git push --follow-tags
```
