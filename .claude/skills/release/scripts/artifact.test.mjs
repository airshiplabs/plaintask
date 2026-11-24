// artifact.test.mjs - identity choice, the build environment, codesign parsing, the artifact verdict, and Sparkle's appcast and signature in artifact.mjs.
//   node --test artifact.test.mjs     (run from this directory)
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import {
  appcastXml, assessArtifact, checksumLine, dmgName, edSignatureProblems, entitlementProblems, launchVerdict, NOTARY_STATE, notarizationProblems, notaryOutcome, parseCodesignDisplay,
  parseSignUpdate, pickIdentity, plistString, tauriEnv,
} from './artifact.mjs';

const HASH_A = 'A'.repeat(40);
const HASH_B = 'B'.repeat(40);
const NAME = 'Developer ID Application: Airship Labs LLC (AB12CD34EF)';
const identities = (...lines) => [...lines, `     ${lines.length} valid identities found`].join('\n');
const DEVELOPER_ID = `  1) ${HASH_A} "${NAME}"`;
const APPLE_DEVELOPMENT = `  2) ${HASH_B} "Apple Development: someone@example.com (ZZ99ZZ99ZZ)"`;

test('dmgName and checksumLine give the release file names', () => {
  assert.equal(dmgName('0.1.0'), 'Plaintask_0.1.0_aarch64.dmg');
  assert.equal(checksumLine('abc', 'Plaintask_0.1.0_aarch64.dmg'), 'abc  Plaintask_0.1.0_aarch64.dmg\n');
});

test('pickIdentity takes the one Developer ID Application identity', () => {
  assert.deepEqual(pickIdentity(identities(DEVELOPER_ID, APPLE_DEVELOPMENT)), { ok: true, identity: NAME, teamName: 'Airship Labs LLC', teamId: 'AB12CD34EF' });
});

test('pickIdentity fails with a reason when none or several exist, and honours --identity', () => {
  assert.match(pickIdentity(identities()).reason, /no Developer ID Application identity/);
  assert.match(pickIdentity(identities(APPLE_DEVELOPMENT)).reason, /no Developer ID Application identity/);
  const two = identities(DEVELOPER_ID, `  2) ${HASH_B} "${NAME}"`);
  assert.match(pickIdentity(two).reason, /2 Developer ID Application identities.*--identity/);
  assert.deepEqual(pickIdentity(two, HASH_B), { ok: true, identity: HASH_B, teamName: 'Airship Labs LLC', teamId: 'AB12CD34EF' });
  assert.match(pickIdentity(two, 'C'.repeat(40)).reason, /matches --identity/);
});

test('tauriEnv removes every Apple variable Tauri reads and sets only the identity', () => {
  const env = { PATH: '/bin', APPLE_ID: 'a', APPLE_PASSWORD: 'b', APPLE_TEAM_ID: 'c', APPLE_API_KEY: 'd', APPLE_API_ISSUER: 'e', APPLE_API_KEY_PATH: 'f', APPLE_CERTIFICATE: 'g', APPLE_CERTIFICATE_PASSWORD: 'h', APPLE_SIGNING_IDENTITY: 'old' };
  assert.deepEqual(tauriEnv(env, NAME), { PATH: '/bin', APPLE_SIGNING_IDENTITY: NAME });
  assert.deepEqual(tauriEnv(env, null), { PATH: '/bin' });
  assert.equal(env.APPLE_ID, 'a', 'the input is not changed');
});

const ADHOC_DISPLAY = [
  'Executable=/tmp/Plaintask.app/Contents/MacOS/plaintask', 'Identifier=com.airshiplabs.plaintask', 'Format=app bundle with Mach-O thin (arm64)',
  'CodeDirectory v=20500 size=30000 flags=0x10002(adhoc,runtime) hashes=900+7 location=embedded', 'Signature=adhoc', 'TeamIdentifier=not set',
].join('\n');
const DEVELOPER_ID_DISPLAY = [
  'Executable=/tmp/Plaintask.app/Contents/MacOS/plaintask', 'Identifier=com.airshiplabs.plaintask',
  'CodeDirectory v=20500 size=30000 flags=0x10000(runtime) hashes=900+7 location=embedded', 'Signature size=9000',
  `Authority=${NAME}`, 'Authority=Developer ID Certification Authority', 'Authority=Apple Root CA',
  'Timestamp=Nov 22, 2026 at 10:00:00', 'TeamIdentifier=AB12CD34EF',
].join('\n');

test('parseCodesignDisplay reads an ad-hoc and a Developer ID signature', () => {
  assert.deepEqual(parseCodesignDisplay(ADHOC_DISPLAY), { identifier: 'com.airshiplabs.plaintask', flags: ['adhoc', 'runtime'], authorities: [], timestamp: null, teamId: null, adhoc: true });
  assert.deepEqual(parseCodesignDisplay(DEVELOPER_ID_DISPLAY), {
    identifier: 'com.airshiplabs.plaintask', flags: ['runtime'], authorities: [NAME, 'Developer ID Certification Authority', 'Apple Root CA'],
    timestamp: 'Nov 22, 2026 at 10:00:00', teamId: 'AB12CD34EF', adhoc: false,
  });
});

const ENTITLEMENTS = { 'com.apple.security.app-sandbox': true, 'com.apple.security.network.client': true };

test('entitlementProblems names missing, changed, extra, and debug entitlements', () => {
  assert.deepEqual(entitlementProblems(ENTITLEMENTS, ENTITLEMENTS), []);
  assert.deepEqual(entitlementProblems(ENTITLEMENTS, { 'com.apple.security.app-sandbox': false }), [
    'com.apple.security.app-sandbox is false, expected true', 'missing com.apple.security.network.client',
  ]);
  assert.deepEqual(entitlementProblems(ENTITLEMENTS, { ...ENTITLEMENTS, 'com.apple.security.get-task-allow': true }), [
    'unexpected com.apple.security.get-task-allow', 'com.apple.security.get-task-allow marks a debug build',
  ]);
});

test('notarizationProblems passes a release signature that is not notarized yet', () => {
  assert.deepEqual(notarizationProblems(parseCodesignDisplay(DEVELOPER_ID_DISPLAY), ENTITLEMENTS, 'AB12CD34EF'), []);
});

test('notarizationProblems names each notary rule a signature breaks', () => {
  const display = parseCodesignDisplay(DEVELOPER_ID_DISPLAY);
  assert.deepEqual(notarizationProblems({ ...display, flags: [] }, ENTITLEMENTS, 'AB12CD34EF'), ['signed without the hardened runtime']);
  assert.deepEqual(notarizationProblems({ ...display, timestamp: null }, ENTITLEMENTS, 'AB12CD34EF'), ['no secure timestamp']);
  assert.deepEqual(notarizationProblems(display, { ...ENTITLEMENTS, 'com.apple.security.get-task-allow': true }, 'AB12CD34EF'), [
    'com.apple.security.get-task-allow marks a debug build',
  ]);
  assert.deepEqual(notarizationProblems(parseCodesignDisplay(ADHOC_DISPLAY), ENTITLEMENTS, 'AB12CD34EF'), [
    'signature is ad-hoc', 'first authority is absent', 'no secure timestamp', 'team is null, expected AB12CD34EF',
  ]);
});

const expected = { sha256: 'abc', version: '0.1.0', teamId: 'AB12CD34EF', entitlements: ENTITLEMENTS, adhoc: false };
const developerIdDmg = parseCodesignDisplay(DEVELOPER_ID_DISPLAY.replace('Identifier=com.airshiplabs.plaintask', 'Identifier=com.airshiplabs.plaintask.dmg'));
const goodFacts = {
  dmgSha256: 'abc', dmgImageValid: true, dmgSignature: { verified: true, display: developerIdDmg }, dmgStapled: true, dmgGatekeeper: true,
  volume: { hasApp: true, applicationsLink: '/Applications' },
  appSignature: { verified: true, display: parseCodesignDisplay(DEVELOPER_ID_DISPLAY) }, appNotarized: true, appDistribution: true,
  entitlements: ENTITLEMENTS, bundleVersion: '0.1.0', bundleBuild: '0.1.0', archs: 'arm64', installerEntitlements: {}, launch: { ready: true, detail: 'ready in 400 ms' },
  appNotaryLog: { status: 'Accepted', issues: null },
  notaryLog: { status: 'Accepted', issues: null },
};
const failed = (facts, want = expected) => assessArtifact(facts, want).checks.filter((check) => !check.ok).map((check) => check.id);

test('assessArtifact passes a notarized Developer ID artifact and lists checks in a fixed order', () => {
  const verdict = assessArtifact(goodFacts, expected);
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.checks.map((check) => check.id), [
    'dmg-sha256', 'dmg-image', 'dmg-signature', 'dmg-stapled', 'dmg-gatekeeper', 'volume-layout', 'app-signature',
    'app-notarized', 'app-distribution', 'app-entitlements', 'app-version', 'app-sparkle-installer', 'app-arch', 'app-launch', 'app-notary-log', 'notary-log',
  ]);
  assert.ok(verdict.checks.every((check) => !check.skipped && check.detail.length > 0));
});

test('assessArtifact fails the one check each bad fact breaks', () => {
  const adhocApp = { verified: true, display: parseCodesignDisplay(ADHOC_DISPLAY) };
  const rows = [
    [{ dmgSha256: 'other' }, ['dmg-sha256']],
    [{ dmgImageValid: false }, ['dmg-image']],
    [{ dmgSignature: { verified: false, display: developerIdDmg } }, ['dmg-signature']],
    [{ dmgSignature: { verified: true, display: { ...developerIdDmg, timestamp: null } } }, ['dmg-signature']],
    [{ dmgStapled: false }, ['dmg-stapled']],
    [{ dmgGatekeeper: false }, ['dmg-gatekeeper']],
    [{ volume: { hasApp: true, applicationsLink: null } }, ['volume-layout']],
    [{ volume: { hasApp: false, applicationsLink: '/Applications' } }, ['volume-layout']],
    [{ appSignature: adhocApp }, ['app-signature']],
    [{ appSignature: { verified: true, display: { ...goodFacts.appSignature.display, teamId: 'ZZ99ZZ99ZZ' } } }, ['app-signature']],
    [{ appSignature: { verified: true, display: { ...goodFacts.appSignature.display, flags: [] } } }, ['app-signature']],
    [{ appNotarized: false }, ['app-notarized']],
    [{ appDistribution: false }, ['app-distribution']],
    [{ entitlements: { ...ENTITLEMENTS, 'com.apple.security.get-task-allow': true } }, ['app-entitlements']],
    [{ bundleVersion: '0.0.9' }, ['app-version']],
    [{ bundleBuild: '4212807' }, ['app-version']],
    [{ installerEntitlements: null }, ['app-sparkle-installer']],
    [{ installerEntitlements: { 'com.apple.security.app-sandbox': true } }, ['app-sparkle-installer']],
    [{ archs: 'x86_64 arm64' }, ['app-arch']],
    [{ launch: { ready: false, detail: 'no "ready" within 15000 ms' } }, ['app-launch']],
    [{ appNotaryLog: null }, ['app-notary-log']],
    [{ appNotaryLog: undefined }, ['app-notary-log']],
    [{ appNotaryLog: { status: 'Invalid', issues: [] } }, ['app-notary-log']],
    [{ appNotaryLog: { status: 'Accepted', issues: [{ severity: 'error', message: 'not signed' }] } }, ['app-notary-log']],
    [{ notaryLog: null }, ['notary-log']],
    [{ notaryLog: { status: 'Invalid', issues: [] } }, ['notary-log']],
    [{ notaryLog: { status: 'Accepted', issues: [{ severity: 'error', message: 'not signed' }] } }, ['notary-log']],
  ];
  for (const [change, ids] of rows) assert.deepEqual(failed({ ...goodFacts, ...change }), ids, JSON.stringify(change));
  assert.deepEqual(failed({ ...goodFacts, notaryLog: { status: 'Accepted', issues: [{ severity: 'warning', message: 'x' }] } }), []);
  assert.deepEqual(failed({ ...goodFacts, appNotaryLog: { status: 'Accepted', issues: [{ severity: 'warning', message: 'x' }] } }), []);
});

test('assessArtifact reports each notary log in its own check detail', () => {
  const detailOf = (facts, id) => assessArtifact(facts, expected).checks.find((check) => check.id === id).detail;
  const appLog = { status: 'Invalid', issues: [{ severity: 'error', message: 'not signed' }, { severity: 'warning', message: 'x' }] };
  assert.equal(detailOf({ ...goodFacts, appNotaryLog: appLog }, 'app-notary-log'), 'status Invalid; 1 error(s), 1 warning(s)');
  assert.equal(detailOf({ ...goodFacts, appNotaryLog: appLog }, 'notary-log'), 'status Accepted; 0 error(s), 0 warning(s)');
  assert.equal(detailOf({ ...goodFacts, appNotaryLog: null }, 'app-notary-log'), 'app-notary-log.json is missing');
});

test('assessArtifact with adhoc skips the Developer ID checks and still judges the rest', () => {
  const adhocFacts = {
    ...goodFacts, dmgSignature: { verified: false, display: parseCodesignDisplay('') }, dmgStapled: false, dmgGatekeeper: false,
    appSignature: { verified: true, display: parseCodesignDisplay(ADHOC_DISPLAY) }, appNotarized: false, appDistribution: false, appNotaryLog: null, notaryLog: null,
  };
  const verdict = assessArtifact(adhocFacts, { ...expected, teamId: null, adhoc: true });
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.checks.filter((check) => check.skipped).map((check) => check.id), ['dmg-signature', 'dmg-stapled', 'dmg-gatekeeper', 'app-notarized', 'app-distribution', 'app-notary-log', 'notary-log']);
  assert.deepEqual(failed({ ...adhocFacts, bundleVersion: '9.9.9' }, { ...expected, teamId: null, adhoc: true }), ['app-version']);
});

// The launch probe deletes its log files when it settles. A read after that is the ENOENT crash of #55.
const deletedLogs = { stdout: () => { throw new Error('ENOENT: stdout.txt'); }, stderr: () => { throw new Error('ENOENT: stderr.txt'); } };
const logs = (stdout, stderr = '') => ({ stdout: () => stdout, stderr: () => stderr });

test('launchVerdict: ready, then the exit of open is ignored without reading the deleted logs', () => {
  assert.equal(launchVerdict(false, { type: 'poll', elapsedMs: 50 }, logs('')), null);
  assert.deepEqual(launchVerdict(false, { type: 'poll', elapsedMs: 100 }, logs('ready')), { ready: true, detail: '"ready" after 100 ms' });
  assert.equal(launchVerdict(true, { type: 'exit', code: 0, elapsedMs: 120 }, deletedLogs), null);
  assert.equal(launchVerdict(true, { type: 'poll', elapsedMs: 150 }, deletedLogs), null);
});

test('launchVerdict: an exit before "ready" fails with the exit code and stderr', () => {
  assert.equal(launchVerdict(false, { type: 'poll', elapsedMs: 50 }, logs('')), null);
  assert.deepEqual(launchVerdict(false, { type: 'exit', code: 1, elapsedMs: 80 }, logs('', 'boom')),
    { ready: false, detail: 'the app exited (open: 1) before "ready"; stderr: boom' });
  assert.equal(launchVerdict(true, { type: 'timeout', limitMs: 15000 }, deletedLogs), null);
});

test('launchVerdict: an exit that follows "ready" between two polls passes', () => {
  assert.deepEqual(launchVerdict(false, { type: 'exit', code: 0, elapsedMs: 80 }, logs('ready')), { ready: true, detail: '"ready" after 80 ms' });
});

test('launchVerdict: a timeout fails with stderr, and the exit after it is ignored', () => {
  assert.equal(launchVerdict(false, { type: 'poll', elapsedMs: 14950 }, logs('')), null);
  assert.deepEqual(launchVerdict(false, { type: 'timeout', limitMs: 15000 }, logs('', 'locked')), { ready: false, detail: 'no "ready" within 15000 ms; stderr: locked' });
  assert.equal(launchVerdict(true, { type: 'exit', code: null, elapsedMs: 15010 }, deletedLogs), null);
});

test('launchVerdict: open that cannot start fails without reading the logs', () => {
  assert.deepEqual(launchVerdict(false, { type: 'error', code: 'ENOENT' }, deletedLogs), { ready: false, detail: 'open did not start: ENOENT' });
  assert.equal(launchVerdict(true, { type: 'error', code: 'ENOENT' }, deletedLogs), null);
});

test('notaryOutcome: Accepted is accepted', () => {
  assert.deepEqual(notaryOutcome({ id: 'abc', status: 'Accepted' }), { state: NOTARY_STATE.accepted, status: 'Accepted' });
});

test('notaryOutcome: Invalid and Rejected are rejected, with the status Apple gave', () => {
  assert.deepEqual(notaryOutcome({ id: 'abc', status: 'Invalid' }), { state: NOTARY_STATE.rejected, status: 'Invalid' });
  assert.deepEqual(notaryOutcome({ id: 'abc', status: 'Rejected' }), { state: NOTARY_STATE.rejected, status: 'Rejected' });
});

test('notaryOutcome: a timeout with no status, and In Progress, are pending', () => {
  assert.deepEqual(notaryOutcome({ id: 'abc', message: 'Timed out waiting for processing' }), { state: NOTARY_STATE.pending, status: 'In Progress' });
  assert.deepEqual(notaryOutcome({ id: 'abc', status: 'In Progress' }), { state: NOTARY_STATE.pending, status: 'In Progress' });
});

test('appcastXml offers the DMG with its EdDSA signature and the notes as Markdown, escaped', () => {
  const xml = appcastXml({ version: '0.3.0', notes: '### Fixed\n\n- A & B <now>', date: 'Mon, 23 Nov 2026 17:00:00 GMT',
    url: 'https://github.com/airshiplabs/plaintask/releases/download/desktop-v0.3.0/Plaintask_0.3.0_aarch64.dmg', length: 4593001, signature: 'c2ln+/=' });
  assert.match(xml, /<sparkle:version>0\.3\.0<\/sparkle:version>/);
  assert.match(xml, /<sparkle:shortVersionString>0\.3\.0<\/sparkle:shortVersionString>/);
  assert.match(xml, /<description sparkle:format="markdown">### Fixed\n\n- A &amp; B &lt;now&gt;<\/description>/);
  assert.match(xml, /<enclosure url="https:\/\/github\.com\/airshiplabs\/plaintask\/releases\/download\/desktop-v0\.3\.0\/Plaintask_0\.3\.0_aarch64\.dmg" length="4593001" type="application\/octet-stream" sparkle:edSignature="c2ln\+\/="\/>/);
});

test('parseSignUpdate reads what sign_update prints, and nothing else', () => {
  assert.deepEqual(parseSignUpdate('sparkle:edSignature="qoTp+/A==" length="3"\n'), { signature: 'qoTp+/A==', length: 3 });
  assert.equal(parseSignUpdate('ERROR! Unable to access required key in the keychain\n'), null);
});

test('edSignatureProblems accepts the key\'s signature and rejects another key, another file and a malformed key', () => {
  const key = generateKeyPairSync('ed25519');
  const publicKey = Buffer.from(key.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64');
  const bytes = Buffer.from('a disk image');
  const signature = sign(null, bytes, key.privateKey).toString('base64');
  assert.deepEqual(edSignatureProblems(publicKey, signature, bytes), []);
  assert.deepEqual(edSignatureProblems(publicKey, signature, Buffer.from('another disk image')), ['the signature does not match the file and SUPublicEDKey']);
  assert.deepEqual(edSignatureProblems(publicKey, sign(null, bytes, generateKeyPairSync('ed25519').privateKey).toString('base64'), bytes), ['the signature does not match the file and SUPublicEDKey']);
  assert.deepEqual(edSignatureProblems('PUBKEY', signature, bytes), ['SUPublicEDKey is not an Ed25519 public key']);
});

test('plistString reads a string key from Info.plist text, and null for a missing or non-string key', () => {
  const xml = '<dict>\n  <key>SUFeedURL</key>\n  <string>https://example.com/a?b=1&amp;c=2</string>\n  <key>SUEnableAutomaticChecks</key>\n  <false/>\n</dict>';
  assert.equal(plistString(xml, 'SUFeedURL'), 'https://example.com/a?b=1&c=2');
  assert.equal(plistString(xml, 'SUEnableAutomaticChecks'), null);
  assert.equal(plistString(xml, 'SUPublicEDKey'), null);
});
