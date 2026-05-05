# Changelog

All notable beta-ready changes should be tracked here.

Keep the `Unreleased` section current during development, then copy it into a versioned release section when cutting a beta build.

## [Unreleased]

### Added

- _No entries yet._

### Changed

- _No entries yet._

### Fixed

- _No entries yet._

### Known issues

- _Add confirmed beta-facing issues here only._

## [b0.7.11:2655] - 2026-05-05

### Fixed

- Fader no longer briefly jumps backward to a stale OS volume during
  continuous mouse drag or MIDI fader movement. The audio-runtime
  commit performed after each PowerShell volume push captured the
  channel reference before the `await`; once the push completed, the
  UI refresh rendered the fader at the just-sent value instead of the
  user's current position. The commit now re-reads the live channel
  from the store, and the post-push branches additionally suppress
  their redundant UI refresh — the fader stays authoritative while
  the user is interacting, and the OS volume follows it.

## [2.0.0-beta.1] - TBD

### Added

- _Fill in shipped additions only._

### Changed

- _Fill in shipped behavior or internal changes only._

### Fixed

- _Fill in shipped fixes only._

### Known issues

- _List only confirmed release-facing issues._
