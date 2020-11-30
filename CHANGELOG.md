# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [3.4.0] - TBD
### Added
- `SMTPClient#sendAsync` API [#267](https://github.com/eleith/emailjs/issues/267)
- `isRFC2822Date` API

### Changed
- use `WeakSet` instead of `WeakMap` for greylist tracking

### Fixed
- use camelCase style for internal function names
- use correct types in jsdoc comments

## [3.3.0] - 2020-08-08
### Added
- greylist support [#202](https://github.com/eleith/emailjs/issues/202)

### Fixed
- check socket is writable before sending [#205](https://github.com/eleith/emailjs/issues/205)

## [3.2.1] - 2020-06-27
### Fixed
- use correct type for `MessageAttachment.stream` [#261](https://github.com/eleith/emailjs/issues/261)
- add missing types in mime functions [#262](https://github.com/eleith/emailjs/pull/262)

## [3.2.0] - 2020-06-19
### Added
- `addressparser` API (forked from dropped dependency) [#259](https://github.com/eleith/emailjs/issues/259)
- `mimeEncode`/`mimeWordEncode` APIs (forked from dropped dependency) [#247](https://github.com/eleith/emailjs/issues/247)

### Changed
- drop dependency on `addressparser` [#259](https://github.com/eleith/emailjs/issues/259)
- drop dependency on `emailjs-mime-codec` [#247](https://github.com/eleith/emailjs/issues/247)

### Fixed
- make `MessageAttachment` interface usable [#254](https://github.com/eleith/emailjs/issues/254)
- mend regression in address type validation [#252](https://github.com/eleith/emailjs/pull/252)

## [3.1.0] - 2020-06-19 [YANKED]

## [3.0.0] - 2020-05-28
### Added
- convert source to strict typescript, listed under the `types` field in `package.json`
- support "dual-package" ESM + CJS via [conditional exports](https://nodejs.org/docs/latest-v14.x/api/esm.html#esm_conditional_exports) & `rollup`-generated bundles
- `SMTPClient#creatMessageStack` API [#229](https://github.com/eleith/emailjs/issues/229)
- `SMTPError` API

### Changed
- simplify public API [#249](https://github.com/eleith/emailjs/issues/249)
- rename `Client` -> `SMTPClient` [#249](https://github.com/eleith/emailjs/issues/249)
- rename `SMTPResponse` -> `SMTPResponseMonitor` [#249](https://github.com/eleith/emailjs/issues/249)

### Removed
- `Message#attach_alternative` API
- `makeSMTPError` API

### Fixed
- filter duplicate message recipients [#242](https://github.com/eleith/emailjs/issues/242)
- error when passing `password` without `user` [#199](https://github.com/eleith/emailjs/issues/199)
- trim `host` before connecting [#136](https://github.com/eleith/emailjs/issues/136)

## [2.2.0] - 2018-07-06
### Added
- expose rfc2822 date module
- annotate code with typescript-compatible jsdoc tags

### Changed
- drop dependency on `moment`
- drop dependency on `starttls`

### Fixed
- ensure timeout is set to default value [#225](https://github.com/eleith/emailjs/issues/225)

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
