// artifact.test.mjs - identity choice, the build environment, codesign parsing, and the artifact verdict in artifact.mjs.
//   node --test artifact.test.mjs     (run from this directory)
import assert from 'node:assert/strict';
import test from 'node:test';
import { assessArtifact, checksumLine, dmgName, entitlementProblems, parseCodesignDisplay, pickIdentity, tauriEnv } from './artifact.mjs';

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

const expected = { sha256: 'abc', version: '0.1.0', buildNumber: '4212807', teamId: 'AB12CD34EF', entitlements: ENTITLEMENTS, adhoc: false };
const developerIdDmg = parseCodesignDisplay(DEVELOPER_ID_DISPLAY.replace('Identifier=com.airshiplabs.plaintask', 'Identifier=com.airshiplabs.plaintask.dmg'));
const goodFacts = {
  dmgSha256: 'abc', dmgImageValid: true, dmgSignature: { verified: true, display: developerIdDmg }, dmgStapled: true, dmgGatekeeper: true,
  volume: { hasApp: true, applicationsLink: '/Applications' },
  appSignature: { verified: true, display: parseCodesignDisplay(DEVELOPER_ID_DISPLAY) }, appNotarized: true, appDistribution: true,
  entitlements: ENTITLEMENTS, bundleVersion: '0.1.0', bundleBuild: '4212807', archs: 'arm64', launch: { ready: true, detail: 'ready in 400 ms' },
  notaryLog: { status: 'Accepted', issues: null },
};
const failed = (facts, want = expected) => assessArtifact(facts, want).checks.filter((check) => !check.ok).map((check) => check.id);

test('assessArtifact passes a notarized Developer ID artifact and lists checks in a fixed order', () => {
  const verdict = assessArtifact(goodFacts, expected);
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.checks.map((check) => check.id), [
    'dmg-sha256', 'dmg-image', 'dmg-signature', 'dmg-stapled', 'dmg-gatekeeper', 'volume-layout', 'app-signature',
    'app-notarized', 'app-distribution', 'app-entitlements', 'app-version', 'app-arch', 'app-launch', 'notary-log',
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
    [{ bundleBuild: '4212807-dirty' }, ['app-version']],
    [{ archs: 'x86_64 arm64' }, ['app-arch']],
    [{ launch: { ready: false, detail: 'no "ready" within 15000 ms' } }, ['app-launch']],
    [{ notaryLog: null }, ['notary-log']],
    [{ notaryLog: { status: 'Invalid', issues: [] } }, ['notary-log']],
    [{ notaryLog: { status: 'Accepted', issues: [{ severity: 'error', message: 'not signed' }] } }, ['notary-log']],
  ];
  for (const [change, ids] of rows) assert.deepEqual(failed({ ...goodFacts, ...change }), ids, JSON.stringify(change));
  assert.deepEqual(failed({ ...goodFacts, notaryLog: { status: 'Accepted', issues: [{ severity: 'warning', message: 'x' }] } }), []);
});

test('assessArtifact with adhoc skips the Developer ID checks and still judges the rest', () => {
  const adhocFacts = {
    ...goodFacts, dmgSignature: { verified: false, display: parseCodesignDisplay('') }, dmgStapled: false, dmgGatekeeper: false,
    appSignature: { verified: true, display: parseCodesignDisplay(ADHOC_DISPLAY) }, appNotarized: false, appDistribution: false, notaryLog: null,
  };
  const verdict = assessArtifact(adhocFacts, { ...expected, teamId: null, adhoc: true });
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.checks.filter((check) => check.skipped).map((check) => check.id), ['dmg-signature', 'dmg-stapled', 'dmg-gatekeeper', 'app-notarized', 'app-distribution', 'notary-log']);
  assert.deepEqual(failed({ ...adhocFacts, bundleVersion: '9.9.9' }, { ...expected, teamId: null, adhoc: true }), ['app-version']);
});
