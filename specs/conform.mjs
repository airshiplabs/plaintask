// conform.mjs - checks that a state machine in the code makes the same transitions as its TLA+ spec.
//
// TLC model-checks the spec and dumps the state graph it explored. The machine is a pure { initial, step, can, events }:
// its state is the spec's `variables`, with the same names and values. For every edge of the graph:
//   - the spec action is one `actions` maps to the machine's events (an action the map does not know fails);
//   - from the edge's start, the machine accepts those events in order and ends where the edge ends.
// For each action in `guarded`, which the code asks can() about before it acts, and for each state where `room` holds:
//   - can(start, event) is true exactly when the spec has that action out of the state.
// And the machine has no event the map never uses. Any difference throws, naming the state and the action.
import assert from 'node:assert/strict';
import { canon, check, pick } from './tlc.mjs';

/** Checks the machine against specs/<spec>.tla. Returns how many states and edges were compared. */
export function conform({ spec, machine, variables, actions, guarded = [], room = () => true }) {
  const { graph } = check(spec);
  const project = state => pick(state, variables);
  const used = new Set(Object.values(actions).flat());
  assert.deepEqual([...machine.events].filter(e => !used.has(e)), [], `events of the machine that no action of ${spec}.tla makes`);

  assert.equal(graph.initial.length, 1, `${spec}.tla should have one initial state`);
  assert.equal(canon(project(graph.states.get(graph.initial[0]))), canon(machine.initial), `the machine starts somewhere ${spec}.tla does not`);

  const out = new Map();   // state id -> actions out of it
  for (const edge of graph.edges) {
    const events = actions[edge.action];
    if (!events) throw new Error(`${spec}.tla has an action ${edge.action} that the test does not map to the machine's events`);
    let at = project(graph.states.get(edge.from));
    for (const event of events) {
      assert.ok(machine.can(at, event), `${edge.action}: the machine refuses "${event}" in ${canon(at)}, which ${spec}.tla allows`);
      at = machine.step(at, event);
    }
    assert.equal(canon(at), canon(project(graph.states.get(edge.to))),
      `${edge.action} from ${canon(project(graph.states.get(edge.from)))}: the machine and ${spec}.tla end in different states`);
    if (!out.has(edge.from)) out.set(edge.from, new Set());
    out.get(edge.from).add(edge.action);
  }

  for (const [id, state] of graph.states) {
    if (!room(state)) continue;
    for (const action of guarded) {
      const [event] = actions[action];
      const allowed = out.get(id)?.has(action) ?? false;
      assert.equal(machine.can(project(state), event), allowed,
        `in ${canon(state)} ${spec}.tla ${allowed ? 'allows' : 'refuses'} ${action}, but the machine's can("${event}") says the opposite`);
    }
  }
  return { states: graph.states.size, checked: graph.edges.length };
}
