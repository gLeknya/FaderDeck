# Beta Release Checklist

## Versioning And Notes

- [ ] Bump the app version in [`package.json`](./package.json).
- [ ] Update [CHANGELOG.md](./CHANGELOG.md) with real shipped changes only.
- [ ] Review [README.md](./README.md) and [ARCHITECTURE.md](./ARCHITECTURE.md) if release scope changed.

## Automated Checks

- [ ] Run `npm run format:check`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run targeted `node --check` for any changed renderer/backend/main JS files when a full lint pass does not cover them.
- [ ] Run `npm run build:dir` or `npm run build` as a pre-release packaging sanity check.

## Manual Smoke Tests

- [ ] Full restart the app after any `main.js`, preload, backend, or PowerShell worker changes.
- [ ] Clean install smoke test on a machine or profile without prior local state.
- [ ] Update/upgrade smoke test from the previous beta build, if an update path exists for this release.
- [ ] Verify profile loading, saving, renaming, deleting, importing, and storage migration behavior.
- [ ] Verify normal channel rendering.
- [ ] Verify channel context menu `Edit`.
- [ ] Verify channel context menu `Delete`.
- [ ] Verify standalone button rendering.
- [ ] Verify standalone button context menu `Edit` and `Delete`, if those controls are exposed in the current UI.
- [ ] Verify MIDI device scan, selection, and reconnect basics.
- [ ] Verify MIDI learn/bind flow for at least one fader and one button action.
- [ ] Verify audio app list refresh.
- [ ] Verify channel volume and mute basics.
- [ ] Verify focused-app targeting still resolves the expected app.
- [ ] Verify media controller buttons still reflect current session state.
- [ ] Verify parked layout editor UI remains hidden.

## Packaging And Release

- [ ] Build the Windows installer with `npm run dist:win`.
- [ ] Smoke test the produced installer.
- [ ] Create a Git tag for the release commit.
- [ ] Publish release artifacts.
- [ ] Attach release notes derived from [CHANGELOG.md](./CHANGELOG.md).

## Known Review Gaps To Watch

- [ ] Renderer `web/js` source is formatted by Prettier, but current `lint` and `typecheck` scripts do not cover it.
- [ ] Hot runtime paths to re-check after risky changes:
  - audio app refresh
  - channel button polling
  - standalone button polling
  - MIDI indicator sync
  - focused-app detection
  - profile migration and local storage compatibility
