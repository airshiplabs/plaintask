# Plaintask {{version}} release report

| Field | Value |
| --- | --- |
| Release | {{releaseUrl}} |
| Published | {{publishedAt}} |
| Tag | `{{tag}}` |
| Commit | `{{sha}}` |
| Release pull request | {{prUrl}} |

## Asset

| Field | Value |
| --- | --- |
| File | `{{dmgName}}` |
| Size | {{bytes}} bytes |
| SHA-256 | `{{sha256}}` |
| Signed by | {{identity}} |
| Team | {{teamId}} |
| Notarization | {{notaryId}}: {{notaryStatus}} |

The asset downloaded from the published release has the SHA-256 above and a valid stapled ticket.

## Verification

| Check | Result | Detail |
| --- | --- | --- |
{{checks}}

## Not covered by this report

Download the DMG in a browser on a Mac that has never run Plaintask, open it, drag the app to Applications, and launch it with the network off. That is the only test of the quarantine path a new user takes.

Pass: macOS asks once whether to open an app downloaded from the internet, says Apple checked it for malicious software and found none, and offers Open. Fail: macOS says the app cannot be opened or that Apple could not verify it, with no Open button.
