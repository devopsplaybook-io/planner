# Changelog

All notable changes to this project are documented here.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.115.0] - 2026-11-26

### Changed

- Refreshed the pinned `common-utils` PR Verify and Main Build workflows to
  commit `7cdda8f`, which adds the shared registry Docker layer cache. No
  application code change; the next builds import the cached layers instead of
  recompiling whisper.cpp under emulated arm64.

## [0.114.0] - 2026-11-26

### Changed

- Adopted the shared PWA update prompt from
  `@devopsplaybook.io/common-web@0.16.0`: switched the service worker from
  `autoUpdate` to `prompt` mode (no more silent reload of open tabs) and added a
  dismissible Reload/Later banner driven by the build-manifest probe and
  `$pwa.needRefresh`. A new build is applied only on explicit user action; the
  offline shell, share target and push notifications are unchanged.

## [0.113.0] - 2026-11-25

### Changed

- Upgraded `@devopsplaybook.io/common-web` from the 0.14.0 beta to the stable
  `^0.14.0` release, adopting the themed login-with-code components.
- Embedded `LoginWithCodeCard` (login page) and `AuthorizeDeviceCard`
  (Settings → Profile) in their `plain` variant with matching heading levels,
  removing nested card chrome and the duplicated "Authorize a device" heading.
- Completed Planner's theme token bridge with `--color-surface-raised`,
  `--color-error` and `--space-base` aliases so the login-code UI follows the
  light, dark and system themes.
