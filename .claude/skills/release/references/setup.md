# One-time setup for releases

A release is signed with a Developer ID Application certificate and notarized by Apple. Both need credentials in the login keychain of the Mac that builds. The person sets these up by hand once. The skill never reads or stores an Apple ID, a password, or a key file.

Check the result at any time:

```sh
node .claude/skills/release/scripts/release.mjs preflight
```

Each failing check prints its id, the reason, and the fix. The ids below match.

## `signing-identity`: Developer ID Application certificate

Needs an Apple Developer Program membership and the Account Holder role.

1. Open Xcode, then Settings, Accounts. Add the Apple ID if it is not listed.
2. Select the team, then Manage Certificates.
3. Click `+`, then Developer ID Application.

Xcode creates the private key in the login keychain and installs the certificate.

A certificate that lives on another Mac: export it there from Keychain Access as a `.p12` file (certificate and private key together), then double-click the file on this Mac to import it.

Check:

```sh
security find-identity -v -p codesigning
```

One line must read `"Developer ID Application: <name> (<TEAMID>)"`. With two or more such lines, pass the SHA-1 hash of the one to use: `release.mjs build --identity <hash>`.

## `signing-probe`: the key signs without a prompt

The first `codesign` with a new key opens a keychain dialog. Choose Always Allow. A release build runs `codesign` many times with nobody at the keyboard, so a dialog stops it.

Trigger the dialog now:

```sh
cp /usr/bin/true /tmp/probe && codesign --force --sign "Developer ID Application: <name> (<TEAMID>)" --timestamp --options runtime /tmp/probe
```

The probe also fails when Apple's timestamp server cannot be reached. Check the network, then run it again.

## `notary-profile`: notarization credentials

Store the credentials under the profile name `plaintask-notary`. `release.mjs` uses that name and no other.

With an Apple ID:

```sh
xcrun notarytool store-credentials "plaintask-notary" --apple-id "<apple id email>" --team-id "<TEAMID>"
```

The command asks for a password. Give an app-specific password, created at account.apple.com under Sign-In and Security, App-Specific Passwords. The Apple ID's own password is refused.

With an App Store Connect API key:

```sh
xcrun notarytool store-credentials "plaintask-notary" --key "<path to AuthKey_XXXX.p8>" --key-id "<key id>" --issuer "<issuer uuid>"
```

Check:

```sh
xcrun notarytool history --keychain-profile "plaintask-notary"
```

## `git-signing`: signed commits and tags

The release commit and the release tag must carry a valid signature. `git config --get commit.gpgsign` must print `true`, and `user.signingkey` must be set. With `gpg.format = ssh`, `gpg.ssh.allowedSignersFile` must name a file that lists the signing key: `git tag -v` cannot verify a tag without it.

## `git-hooks`: the commit-msg and pre-commit hooks

```sh
pnpm run prepare
```

This copies `.githooks/commit-msg` and `.githooks/pre-commit` into the shared `.git/hooks/`. The first checks the release commit's message; the second checks the changelog the release commit stages. `core.hooksPath` must be unset.

## `tools` and `host`

Xcode supplies `codesign`, `notarytool`, `stapler`, `hdiutil`, `spctl`, and `syspolicy_check` (macOS 14 or later). The build needs `node` 22 or later, `pnpm`, `cargo`, and `gh`. `rustc -vV` must report `host: aarch64-apple-darwin`: a release is built on an Apple Silicon Mac, for Apple Silicon Macs.

## `github`

```sh
gh auth login
```

The signed-in user must be able to push tags and create releases on `airshiplabs/plaintask`.

## `clean-tree`, `head-at-main`, `manifests`, `ci-main`

These describe the checkout, not the machine.

| Check | Fix |
| --- | --- |
| `clean-tree` | Commit or remove changes and untracked files. |
| `head-at-main` | `git switch --detach origin/main`. The quality gates must test the code being released. |
| `manifests` | The four version files on `origin/main` disagree. Fix them in a pull request. |
| `ci-main` | The `test` check on `origin/main` is failing or still running. Wait, or fix it in a pull request. |
