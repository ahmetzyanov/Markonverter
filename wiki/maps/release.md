# Release: Chrome Web Store auto-publish

How a new version reaches the Chrome Web Store. Fully automated since v0.2.0
(2026-07-06); v0.1.0 was uploaded by hand.

## To ship a release

1. Bump the version in **both** `src/manifest.json` and `package.json`
   (they must stay in sync; the store rejects a version <= the published one).
2. Commit and push to `main`.
3. `git tag vX.Y.Z && git push origin vX.Y.Z`

That's it. The tag push triggers `.github/workflows/release.yml`, which runs
typecheck + tests, builds `dist/`, zips its contents (manifest at zip root),
uploads and publishes to the Chrome Web Store, and creates a GitHub release
with the zip attached. The store then holds the version in review (hours to
days) before rollout.

## Credentials

Four GitHub Actions secrets on `ahmetzyanov/Markonverter` (already set):
`CHROME_EXTENSION_ID`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`,
`CHROME_REFRESH_TOKEN`.

- Extension ID: `flbejmhomeeabmccjalfcenmpjhpbhjl`.
- OAuth client lives in the owner's Google Cloud project; consent screen is
  published to Production so the refresh token does not expire in 7 days.
- To regenerate credentials: `npx chrome-webstore-upload-keys` (interactive,
  must run in the foreground), guide at
  https://github.com/fregante/chrome-webstore-upload-keys — then
  `gh secret set` the new values.
- A local gitignored `.env` in the repo root may hold a backup copy of the
  OAuth values. Never print or commit it.

## Notes

- The workflow pins `chrome-webstore-upload-cli@3.5.0`: 4.x dropped the CLI
  auth flags in favor of env-var-only auth.
- Upload and publish are separate steps on purpose, so publish can later be
  gated on manual approval without restructuring.
