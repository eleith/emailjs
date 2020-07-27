# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [3.2.1] - 2020-06-27
### Fixed
- use correct type for `MessageAttachment.stream`
- add missing types in mime functions

## [3.2.0] - 2020-06-19
### Added
- `addressparser` API (forked from dropped dependency)
- `mimeEncode`/`mimeWordEncode` APIs (forked from dropped dependency)

### Changed
- drop dependency on `addressparser`
- drop dependency on `emailjs-mime-codec`

### Fixed
- make `MessageAttachment` interface usable
- mend regression in address type validation

## [3.1.0] - 2020-06-19 [YANKED]

## [3.0.0] - 2020-05-28
### Added
- convert source to strict typescript, listed under the `types` field in `package.json`
- support "dual-package" ESM + CJS via [conditional exports](https://nodejs.org/api/esm.html#esm_conditional_exports) & `rollup`-generated bundles
- `SMTPClient#creatMessageStack` API
- `SMTPError` API

### Changed
- simplify public API
- rename `Client` -> `SMTPClient`
- rename `SMTPResponse` -> `SMTPResponseMonitor`

### Removed
- `Message#attach_alternative` API
- `makeSMTPError` API

### Fixed
- filter duplicate message recipients
- error when passing `password` without `user`
- trim `host` before connecting

## [2.2.0] - 2018-07-06
### Added
- expose rfc2822 date module
- annotate code with typescript-compatible jsdoc tags

### Changed
- drop dependency on `moment`
- drop dependency on `starttls`

### Fixed
- ensure timeout is set to default value

## [2.1.0] - 2018-06-09
### Added
- expose error module

### Changed
- handle errors with `fs.closeSync` instead of `fs.close`
- refactor to ES2015+ constructs
- lint & format with eslint + prettier
- drop optional dependency on `bufferjs`

### Fixed
- remove `new Buffer` calls

## [2.0.1] - 2018-02-11
### Added
- a new changelog
