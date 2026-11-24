// artifact.mjs - the macOS artifact's pure rules: which signing identity to use, the build environment,
// file names, reading codesign output, the verdict on a built DMG, and Sparkle's appcast and signature. No I/O and no globals.
import { createPublicKey, verify } from 'node:crypto';

export const PRODUCT_NAME = 'Plaintask';
export const BUNDLE_ID = 'com.airshiplabs.plaintask';
export const DMG_IDENTIFIER = `${BUNDLE_ID}.dmg`;
export const ARCH = 'aarch64';
/** What `lipo -archs` prints for the one architecture a release ships. */
export const MACHO_ARCH = 'arm64';
export const CHECKSUMS_NAME = 'SHA256SUMS.txt';

/** How an artifact was signed. Only a developer-id artifact can be staged. */
export const SIGNATURE = Object.freeze({ developerId: 'developer-id', adhoc: 'adhoc' });

// Tauri signs with APPLE_SIGNING_IDENTITY and notarizes by itself when the credential variables are set.
// The release notarizes the DMG in its own step, so a build starts with none of them.
const TAURI_APPLE_VARIABLES = Object.freeze([
  'APPLE_SIGNING_IDENTITY', 'APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID', 'APPLE_API_KEY', 'APPLE_API_ISSUER',
  'APPLE_API_KEY_PATH', 'APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD', 'APPLE_PROVIDER_SHORT_NAME',
]);

const IDENTITY_LINE = /^\s*\d+\) ([0-9A-F]{40}) "(Developer ID Application: (.+) \(([A-Z0-9]{10})\))"/;
const DEVELOPER_ID_AUTHORITY = 'Developer ID Application: ';
const DEBUG_ENTITLEMENT = 'com.apple.security.get-task-allow';
const NOTARY_ERROR = 'error';

/** The DMG file name for a version: Tauri's own `<product>_<version>_<arch>.dmg` form. */
export function dmgName(version) {
  return `${PRODUCT_NAME}_${version}_${ARCH}.dmg`;
}

/** One line of SHA256SUMS.txt in the form `shasum -a 256 -c` reads. */
export function checksumLine(sha256, fileName) {
  return `${sha256}  ${fileName}\n`;
}

/**
 * Choose the Developer ID Application identity from `security find-identity -v -p codesigning` output.
 * With no `override`, exactly one must exist. An `override` must equal one identity's name or SHA-1 hash.
 * @returns {{ ok: true, identity: string, teamName: string, teamId: string } | { ok: false, reason: string }}
 */
export function pickIdentity(findIdentityOutput, override) {
  const found = findIdentityOutput.split('\n').map((line) => IDENTITY_LINE.exec(line)).filter(Boolean)
    .map(([, hash, name, teamName, teamId]) => ({ hash, name, teamName, teamId }));
  if (override !== undefined) {
    const match = found.find(({ hash, name }) => override === hash || override === name);
    if (!match) return { ok: false, reason: `no Developer ID Application identity matches --identity ${JSON.stringify(override)}` };
    return { ok: true, identity: override, teamName: match.teamName, teamId: match.teamId };
  }
  if (found.length === 0) return { ok: false, reason: 'no Developer ID Application identity is in the keychain' };
  if (found.length > 1) {
    return { ok: false, reason: `${found.length} Developer ID Application identities are in the keychain; pass --identity <SHA-1 hash>: ${found.map(({ hash }) => hash).join(', ')}` };
  }
  return { ok: true, identity: found[0].name, teamName: found[0].teamName, teamId: found[0].teamId };
}

/**
 * The environment for `tauri build`: `env` without Tauri's Apple variables, plus APPLE_SIGNING_IDENTITY when
 * `identity` is given. With a null identity Tauri uses tauri.conf.json's ad-hoc "-".
 */
export function tauriEnv(env, identity) {
  const cleaned = Object.fromEntries(Object.entries(env).filter(([name]) => !TAURI_APPLE_VARIABLES.includes(name)));
  return identity === null ? cleaned : { ...cleaned, APPLE_SIGNING_IDENTITY: identity };
}

/**
 * Read `codesign -dvv` output (it prints on stderr).
 * @returns {{ identifier: string | null, flags: string[], authorities: string[], timestamp: string | null, teamId: string | null, adhoc: boolean }}
 */
export function parseCodesignDisplay(text) {
  const lines = text.split('\n');
  const value = (key) => lines.find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1) ?? null;
  const flags = /^CodeDirectory .*\bflags=0x[0-9a-f]+\(([^)]*)\)/m.exec(text);
  const teamId = value('TeamIdentifier');
  return {
    identifier: value('Identifier'),
    flags: flags ? flags[1].split(',') : [],
    authorities: lines.filter((line) => line.startsWith('Authority=')).map((line) => line.slice('Authority='.length)),
    timestamp: value('Timestamp'),
    teamId: teamId === 'not set' ? null : teamId,
    adhoc: value('Signature') === 'adhoc',
  };
}

/** Why `actual` entitlements differ from `expected`, one sentence each. [] when they are the same. */
export function entitlementProblems(expected, actual) {
  const problems = [];
  for (const key of Object.keys(expected)) {
    if (!Object.hasOwn(actual, key)) problems.push(`missing ${key}`);
    else if (JSON.stringify(actual[key]) !== JSON.stringify(expected[key])) problems.push(`${key} is ${JSON.stringify(actual[key])}, expected ${JSON.stringify(expected[key])}`);
  }
  for (const key of Object.keys(actual)) {
    if (!Object.hasOwn(expected, key)) problems.push(`unexpected ${key}`);
  }
  if (Object.hasOwn(actual, DEBUG_ENTITLEMENT)) problems.push(`${DEBUG_ENTITLEMENT} marks a debug build`);
  return [...new Set(problems)];
}

/**
 * The verdict on a built DMG, from facts `release.mjs verify` gathers. Returns the checks in a fixed order;
 * each has an `id`, `ok`, and a one-line `detail`. With `expected.adhoc`, the checks only a Developer ID
 * signature can pass are returned with `skipped: true` and do not count.
 * @param {{
 *   dmgSha256: string, dmgImageValid: boolean,
 *   dmgSignature: { verified: boolean, display: ReturnType<typeof parseCodesignDisplay> },
 *   dmgStapled: boolean, dmgGatekeeper: boolean,
 *   volume: { hasApp: boolean, applicationsLink: string | null },
 *   appSignature: { verified: boolean, display: ReturnType<typeof parseCodesignDisplay> },
 *   appNotarized: boolean, appDistribution: boolean,
 *   entitlements: Record<string, unknown>, bundleVersion: string | null, bundleBuild: string | null, archs: string | null,
 *   installerEntitlements: Record<string, unknown> | null,
 *   launch: { ready: boolean, detail: string },
 *   appNotaryLog: { status: string, issues: { severity: string, message: string }[] | null } | null,
 *   notaryLog: { status: string, issues: { severity: string, message: string }[] | null } | null,
 * }} facts
 * @param {{ sha256: string, version: string, teamId: string | null, entitlements: Record<string, unknown>, adhoc: boolean }} expected
 * @returns {{ ok: boolean, checks: { id: string, ok: boolean, skipped?: true, detail: string }[] }}
 */
export function assessArtifact(facts, expected) {
  const developerIdOnly = (id, ok, detail) => (expected.adhoc ? { id, ok: true, skipped: true, detail: 'skipped (adhoc)' } : { id, ok, detail });
  const dmg = facts.dmgSignature;
  const app = facts.appSignature;
  const entitlements = entitlementProblems(expected.entitlements, facts.entitlements);
  const appLogErrors = (facts.appNotaryLog?.issues ?? []).filter((issue) => issue.severity === NOTARY_ERROR);
  const appLogWarnings = (facts.appNotaryLog?.issues ?? []).length - appLogErrors.length;
  const logErrors = (facts.notaryLog?.issues ?? []).filter((issue) => issue.severity === NOTARY_ERROR);
  const logWarnings = (facts.notaryLog?.issues ?? []).length - logErrors.length;

  const appProblems = [
    !app.verified && 'codesign --verify --deep --strict failed',
    app.display.identifier !== BUNDLE_ID && `identifier is ${app.display.identifier}`,
    // An ad-hoc build is signed without the hardened runtime: its library validation refuses Sparkle.framework without a Team ID.
    ...(expected.adhoc ? [] : [!app.display.flags.includes('runtime') && 'hardened runtime is off', ...developerIdProblems(app.display, expected.teamId)]),
  ].filter(Boolean);

  const checks = [
    { id: 'dmg-sha256', ok: facts.dmgSha256 === expected.sha256, detail: facts.dmgSha256 },
    { id: 'dmg-image', ok: facts.dmgImageValid, detail: 'hdiutil verify' },
    developerIdOnly('dmg-signature', dmg.verified && developerIdProblems(dmg.display, expected.teamId).length === 0,
      dmg.verified ? developerIdProblems(dmg.display, expected.teamId).join('; ') || dmg.display.authorities[0] : 'codesign --verify --strict failed'),
    developerIdOnly('dmg-stapled', facts.dmgStapled, 'stapler validate'),
    developerIdOnly('dmg-gatekeeper', facts.dmgGatekeeper, 'spctl -a -t open --context context:primary-signature'),
    { id: 'volume-layout', ok: facts.volume.hasApp && facts.volume.applicationsLink === '/Applications',
      detail: `${PRODUCT_NAME}.app ${facts.volume.hasApp ? 'present' : 'missing'}; Applications -> ${facts.volume.applicationsLink}` },
    { id: 'app-signature', ok: appProblems.length === 0, detail: appProblems.join('; ') || (app.display.authorities[0] ?? 'adhoc') },
    developerIdOnly('app-notarized', facts.appNotarized, 'codesign --check-notarization'),
    developerIdOnly('app-distribution', facts.appDistribution, 'syspolicy_check distribution'),
    { id: 'app-entitlements', ok: entitlements.length === 0, detail: entitlements.join('; ') || `${Object.keys(facts.entitlements).length} entitlements match Entitlements.plist` },
    // Sparkle compares an update's version with CFBundleVersion, so both carry the release's version.
    { id: 'app-version', ok: facts.bundleVersion === expected.version && facts.bundleBuild === expected.version,
      detail: `CFBundleShortVersionString ${facts.bundleVersion}, CFBundleVersion ${facts.bundleBuild}` },
    // Notarization accepts a sandboxed Installer.xpc, but then Sparkle cannot launch the installer and no update installs.
    { id: 'app-sparkle-installer', ok: facts.installerEntitlements !== null && !facts.installerEntitlements['com.apple.security.app-sandbox'],
      detail: facts.installerEntitlements === null ? `no ${SPARKLE_INSTALLER} in the app` : facts.installerEntitlements['com.apple.security.app-sandbox'] ? `${SPARKLE_INSTALLER} is signed with the app sandbox` : `${SPARKLE_INSTALLER} is signed outside the sandbox` },
    { id: 'app-arch', ok: facts.archs === MACHO_ARCH, detail: `lipo -archs ${facts.archs}` },
    { id: 'app-launch', ok: facts.launch.ready, detail: facts.launch.detail },
    developerIdOnly('app-notary-log', facts.appNotaryLog?.status === 'Accepted' && appLogErrors.length === 0,
      facts.appNotaryLog ? `status ${facts.appNotaryLog.status}; ${appLogErrors.length} error(s), ${appLogWarnings} warning(s)` : 'app-notary-log.json is missing'),
    developerIdOnly('notary-log', facts.notaryLog?.status === 'Accepted' && logErrors.length === 0,
      facts.notaryLog ? `status ${facts.notaryLog.status}; ${logErrors.length} error(s), ${logWarnings} warning(s)` : 'notary-log.json is missing'),
  ];
  return { ok: checks.every((check) => check.ok), checks };
}

/**
 * What Apple's notary service rejects in an app signature, found from `codesign` facts before upload. [] when nothing.
 * `syspolicy_check notary-submission` cannot do this: it asks Gatekeeper, which rejects every app that is not notarized yet.
 */
export function notarizationProblems(display, entitlements, teamId) {
  return [
    !display.flags.includes('runtime') && 'signed without the hardened runtime',
    ...developerIdProblems(display, teamId),
    Object.hasOwn(entitlements, DEBUG_ENTITLEMENT) && `${DEBUG_ENTITLEMENT} marks a debug build`,
  ].filter(Boolean);
}

/** What stops a signature from being a timestamped Developer ID signature by team `teamId`. [] when nothing does. */
export function developerIdProblems(display, teamId) {
  return [
    display.adhoc && 'signature is ad-hoc',
    !display.authorities[0]?.startsWith(DEVELOPER_ID_AUTHORITY) && `first authority is ${display.authorities[0] ?? 'absent'}`,
    display.timestamp === null && 'no secure timestamp',
    display.teamId !== teamId && `team is ${display.teamId}, expected ${teamId}`,
  ].filter(Boolean);
}

/** Where a notary submission stands. */
export const NOTARY_STATE = Object.freeze({ accepted: 'accepted', rejected: 'rejected', pending: 'pending' });
const NOTARY_STATUS_ACCEPTED = 'Accepted';
const NOTARY_STATUS_IN_PROGRESS = 'In Progress';

/**
 * Where a notary submission stands, from the JSON of `notarytool info` or `notarytool submit --wait`.
 * A wait that timed out reports no status: the submission is still in progress.
 * @param {{ status?: string }} result
 * @returns {{ state: 'accepted' | 'rejected' | 'pending', status: string }}
 */
export function notaryOutcome(result) {
  const status = result.status ?? NOTARY_STATUS_IN_PROGRESS;
  if (status === NOTARY_STATUS_IN_PROGRESS) return { state: NOTARY_STATE.pending, status };
  return { state: status === NOTARY_STATUS_ACCEPTED ? NOTARY_STATE.accepted : NOTARY_STATE.rejected, status };
}

/**
 * The launch probe's verdict on one event, or null while it must keep waiting.
 * After the probe has `settled` every event gives null and `logs` is not read: settling deletes the log files,
 * and `open` exits after that.
 * @param {boolean} settled
 * @param {{ type: 'poll', elapsedMs: number } | { type: 'exit', code: number | null, elapsedMs: number } | { type: 'timeout', limitMs: number } | { type: 'error', code: string }} event
 * @param {{ stdout: () => string, stderr: () => string }} logs reads the app's output files
 * @returns {{ ready: boolean, detail: string } | null}
 */
export function launchVerdict(settled, event, logs) {
  if (settled) return null;
  if (event.type === 'error') return { ready: false, detail: `open did not start: ${event.code}` };
  if (event.type === 'timeout') return { ready: false, detail: `no "ready" within ${event.limitMs} ms; stderr: ${logs.stderr()}` };
  if (logs.stdout().includes('ready')) return { ready: true, detail: `"ready" after ${event.elapsedMs} ms` };
  if (event.type === 'exit') return { ready: false, detail: `the app exited (open: ${event.code}) before "ready"; stderr: ${logs.stderr()}` };
  return null;
}

/** Sparkle's installer service, inside the app. It must be signed without the app's sandbox entitlements. */
export const SPARKLE_INSTALLER = 'Contents/Frameworks/Sparkle.framework/Versions/B/XPCServices/Installer.xpc';

/** A string value from property-list XML, such as Info.plist's SUFeedURL, or null when the key has no string. Needs no plutil. */
export function plistString(xml, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = new RegExp(`<key>${escaped}</key>\\s*<string>([^<]*)</string>`).exec(xml ?? '');
  return found ? found[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&') : null;
}

/** The update feed the app reads (Info.plist SUFeedURL): an asset of each release, read through releases/latest. */
export const APPCAST_NAME = 'appcast.xml';

const xmlText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Sparkle's appcast for one release: the DMG at `url`, its EdDSA `signature` and `length` from sign_update, and the
 * changelog section as Markdown release notes. `date` is an RFC 822 date, such as Date#toUTCString gives.
 */
export function appcastXml({ version, notes, date, url, length, signature }) {
  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>${PRODUCT_NAME}</title>
    <item>
      <title>${xmlText(version)}</title>
      <sparkle:version>${xmlText(version)}</sparkle:version>
      <sparkle:shortVersionString>${xmlText(version)}</sparkle:shortVersionString>
      <pubDate>${xmlText(date)}</pubDate>
      <description sparkle:format="markdown">${xmlText(notes)}</description>
      <enclosure url="${xmlText(url)}" length="${length}" type="application/octet-stream" sparkle:edSignature="${xmlText(signature)}"/>
    </item>
  </channel>
</rss>
`;
}

/** sign_update's output, `sparkle:edSignature="…" sparkle:length="…"`, as { signature, length }, or null when it is not that.
    With a key file (--ed-key-file) it prints `length=` without the prefix. */
export function parseSignUpdate(stdout) {
  const found = /sparkle:edSignature="([A-Za-z0-9+/=]+)"\s+(?:sparkle:)?length="(\d+)"/.exec(stdout);
  return found ? { signature: found[1], length: Number(found[2]) } : null;
}

/**
 * What is wrong with an update's EdDSA signature, as Sparkle checks it before installing. [] when nothing.
 * `publicKey` is SUPublicEDKey from the app's Info.plist (base64 of 32 bytes), `signature` the base64 signature.
 */
export function edSignatureProblems(publicKey, signature, bytes) {
  const raw = Buffer.from(publicKey ?? '', 'base64');
  if (raw.length !== 32) return ['SUPublicEDKey is not an Ed25519 public key'];
  const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' });
  return verify(null, bytes, key, Buffer.from(signature, 'base64')) ? [] : ['the signature does not match the file and SUPublicEDKey'];
}
