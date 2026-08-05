# Cross-repo contract fixtures

Golden files describing what the API actually puts on the wire, parsed by BOTH
sides in CI.

They exist because the two sides were verified independently and could still
disagree. `ManifestParsingTest` on the player parsed a JSON string typed by hand
inside the test file; the API's own tests asserted against its own types. Rename
`signedUrl` to `signedURL` on the server and **both suites stay green** while
every screen in the fleet goes blank — the player parses a manifest whose media
fields are all null and renders nothing.

A fixture only closes that hole if both sides read the _same bytes_:

- **API** — `device-manifest.contract.spec.ts` builds a value typed as
  `ScreenPlaybackManifest` and asserts the fixture's key set matches it exactly.
  A renamed or removed field fails to compile; an added one fails the key
  comparison. Either way the fixture must be regenerated deliberately.
- **Player** — `ManifestContractTest` parses these exact files with
  `ignoreUnknownKeys = false`. Production keeps `ignoreUnknownKeys = true` so the
  player tolerates additive backend changes at runtime; the test is strict on
  purpose, so a field the API sends and the player does not model is a build
  failure rather than a value silently discarded.

## Changing the manifest

1. Change the API interface.
2. Update the fixture to match.
3. Run the player tests. If the Kotlin model is missing the field, they fail —
   add it.

Skipping step 3 is the failure this directory exists to prevent.

## Contents

| File                                    | Covers                                                                                                                                              |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `device-manifest.schedule.golden.json`  | The ordinary path: a scheduled playlist with one item of every content type, and the `pageCount` metadata shape.                                    |
| `device-manifest.emergency.golden.json` | An emergency broadcast: synthetic `emg:` content ids, the `emergency` metadata shape, and the null-heavy item fields that go with TEXT/URL content. |

Values are synthetic. No real screen ids, tenant data, hostnames, or signed
URLs — the signed URLs point at `example.com`, which is reserved for
documentation (RFC 2606).
