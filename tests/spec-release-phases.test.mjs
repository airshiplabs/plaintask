// .claude/skills/release/scripts/plan.mjs against specs/ReleasePhases.tla: in every state TLC finds, derivePhase()
// must name the spec's phase and nextTask() the spec's next brief. A rule changed on one side only fails here.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { derivePhase, NEXT_TASK, nextTask, PHASES } from '../.claude/skills/release/scripts/plan.mjs';
import { canon, check } from '../specs/tlc.mjs';

/** The facts `release.mjs status` would gather in a spec state, in the shapes it reads them. */
function factsOf(state) {
  const { pr, main, build, verify, tag, release } = state;
  return {
    phase: {
      release: release === 'none' ? null : { isDraft: release === 'draft' },
      build: build.exists ? (build.sha256 > 0 ? { sha256: `dmg-${build.sha256}` } : { notary: { id: 'submitted' } }) : null,
      verify: verify.exists ? { ok: verify.ok, sha256: `dmg-${verify.sha256}` } : null,
      mainHasRelease: main,
      pr: pr === 'none' ? null : { state: pr },
    },
    // As status() works them out. The spec has no commits after the release, so main is never ahead of the build.
    next: { verifyFailed: verify.exists && !verify.ok, replaceable: !tag && release === 'none', mainAhead: false },
  };
}

test('derivePhase() and nextTask() name the phase and the next brief specs/ReleasePhases.tla does, in every state', { timeout: 60000 }, () => {
  const { graph } = check('ReleasePhases');
  const phases = new Set(), tasks = new Set();
  for (const state of graph.states.values()) {
    const facts = factsOf(state);
    const phase = derivePhase(facts.phase);
    assert.equal(phase, state.phase, `derivePhase() in ${canon(state)}`);
    assert.equal(nextTask(phase, facts.next), state.next, `nextTask() in ${canon(state)}`);
    phases.add(phase);
    tasks.add(state.next);
  }
  assert.deepEqual([...phases].sort(), [...PHASES].sort(), 'the spec should reach every phase plan.mjs has, and no other');
  assert.deepEqual([...tasks].sort(), [...new Set(Object.values(NEXT_TASK))].sort(), 'the spec should name every brief NEXT_TASK has, and no other');
});
