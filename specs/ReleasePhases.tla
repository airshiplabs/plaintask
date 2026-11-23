--------------------------- MODULE ReleasePhases ---------------------------
(***************************************************************************)
(* One desktop release, from its pull request to its published GitHub     *)
(* release, as .claude/skills/release/scripts/release.mjs runs it.        *)
(*                                                                         *)
(* Code: derivePhase() and nextTask() in plan.mjs name the phase a release *)
(* is in and the brief to run next, from facts `release.mjs status`        *)
(* gathers. The commands below are release.mjs's pr, build, verify, qa,   *)
(* stage and publish, each with the checks it makes before it changes      *)
(* anything, and the steps of people and GitHub around them. A build's DMG *)
(* is named by a number standing for its SHA-256.                         *)
(*                                                                         *)
(* tests/spec-release-phases.test.mjs fails when derivePhase() or          *)
(* nextTask() and PhaseOf or NextOf here disagree on any state TLC finds.  *)
(***************************************************************************)
EXTENDS Naturals

CONSTANT MaxBuilds   \* how many builds the model explores

Phases == <<"plan", "pr-open", "pr-merged", "built", "verified", "qa-passed", "staged", "published">>
Order(p) == CHOOSE i \in 1..8 : Phases[i] = p
Task == [plan |-> "draft-changelog", pr_open |-> "land-release-pr", pr_merged |-> "build-artifact",
         built |-> "verify-artifact", verified |-> "qa-release", qa_passed |-> "stage-release",
         staged |-> "publish-release", published |-> "done"]
TaskOf(p) == CASE p = "plan" -> Task.plan [] p = "pr-open" -> Task.pr_open [] p = "pr-merged" -> Task.pr_merged
               [] p = "built" -> Task.built [] p = "verified" -> Task.verified [] p = "qa-passed" -> Task.qa_passed
               [] p = "staged" -> Task.staged [] p = "published" -> Task.published

VARIABLES
  pr,       \* the release pull request: "none", "OPEN", "CLOSED" (unmerged) or "MERGED"
  main,     \* origin/main holds the release: its changelog and the four version manifests
  build,    \* build.json: whether it exists, and its DMG's SHA-256 (0 while notarization has not finished)
  verify,   \* verify.json: whether it exists, whether it passed, and the SHA-256 it checked
  qa,       \* qa.json: whether it exists, whether QA found no blocker, and the SHA-256 of the build it ran on
  tag,      \* the signed desktop-v<V> tag is on origin
  release,  \* the GitHub release: "none", "draft" or "published"
  builds,   \* how many builds were started, so each finished DMG has a new SHA-256
  phase,    \* PhaseOf the facts above, as status reports it
  next      \* NextOf the facts above, as status reports it

facts == <<pr, main, build, verify, qa, tag, release>>
vars  == <<pr, main, build, verify, qa, tag, release, builds, phase, next>>

Built(b) == b.exists /\ b.sha256 > 0
Verified(b, v) == Built(b) /\ v.exists /\ v.ok /\ v.sha256 = b.sha256
QaPassed(b, v, q) == Verified(b, v) /\ q.exists /\ q.ok /\ q.sha256 = b.sha256
QaBlocked(b, q) == q.exists /\ ~q.ok /\ q.sha256 = b.sha256

\* derivePhase(): the most advanced phase the facts prove.
PhaseOf(p, m, b, v, q, r) ==
  IF r /= "none" THEN (IF r = "draft" THEN "staged" ELSE "published")
  ELSE IF QaPassed(b, v, q) THEN "qa-passed"
  ELSE IF Verified(b, v) THEN "verified"
  ELSE IF Built(b) THEN "built"
  ELSE IF m THEN "pr-merged"
  ELSE IF p = "OPEN" THEN "pr-open"
  ELSE "plan"

\* nextTask(): the brief for the phase, except after a failed verify of a release not yet published, or a QA run that
\* found a blocker. A build no tag or release holds yet is built again; one they hold cannot be, so it is verified or
\* QA'd again (stage and publish refuse it until both pass).
NextOf(p, m, b, v, q, t, r) ==
  IF r /= "published" /\ v.exists /\ ~v.ok THEN (IF ~t /\ r = "none" THEN Task.pr_merged ELSE Task.built)
  ELSE IF PhaseOf(p, m, b, v, q, r) = "verified" /\ QaBlocked(b, q) THEN (IF ~t /\ r = "none" THEN Task.pr_merged ELSE Task.verified)
  ELSE TaskOf(PhaseOf(p, m, b, v, q, r))

None == [exists |-> FALSE, ok |-> FALSE, sha256 |-> 0]

Init ==
  /\ pr = "none" /\ main = FALSE /\ build = [exists |-> FALSE, sha256 |-> 0] /\ verify = None /\ qa = None
  /\ tag = FALSE /\ release = "none" /\ builds = 0
  /\ phase = "plan" /\ next = Task.plan

(* ---- the commands, and what moves outside them ---- *)

\* release.mjs pr: opens the pull request unless one is open or merged.
OpenPr  == pr \in {"none", "CLOSED"} /\ ~main /\ pr' = "OPEN" /\ UNCHANGED <<main, build, verify, qa, tag, release, builds>>
\* A person closes it unmerged.
ClosePr == pr = "OPEN" /\ pr' = "CLOSED" /\ UNCHANGED <<main, build, verify, qa, tag, release, builds>>
\* release.mjs pr: once CI passes, squash-merges it.
MergePr == pr = "OPEN" /\ pr' = "MERGED" /\ main' = TRUE /\ UNCHANGED <<build, verify, qa, tag, release, builds>>
\* release.mjs build: refused once a GitHub release exists. A new build removes verify.json and qa.json and submits
\* for notarization.
StartBuild == main /\ release = "none" /\ build' = [exists |-> TRUE, sha256 |-> 0] /\ verify' = None /\ qa' = None
              /\ builds' = builds + 1
              /\ UNCHANGED <<pr, main, tag, release>>
\* release.mjs build, run again: notarization is accepted and the DMG gets its SHA-256.
FinishBuild == build.exists /\ build.sha256 = 0 /\ build' = [exists |-> TRUE, sha256 |-> builds]
              /\ UNCHANGED <<pr, main, verify, qa, tag, release, builds>>
\* release.mjs verify: checks the finished DMG; it passes or it does not.
Verify(ok) == Built(build) /\ verify' = [exists |-> TRUE, ok |-> ok, sha256 |-> build.sha256]
              /\ UNCHANGED <<pr, main, build, qa, tag, release, builds>>
\* release.mjs qa: records the QA run of the verified build; refused once a GitHub release exists. It finds a blocker
\* or it does not.
Qa(ok) == Verified(build, verify) /\ release = "none" /\ qa' = [exists |-> TRUE, ok |-> ok, sha256 |-> build.sha256]
          /\ UNCHANGED <<pr, main, build, verify, tag, release, builds>>
\* release.mjs stage: needs a verified build that passed QA; pushes the tag, then makes the draft release. Either may be all a run does.
PushTag     == QaPassed(build, verify, qa) /\ release /= "published" /\ ~tag /\ tag' = TRUE
               /\ UNCHANGED <<pr, main, build, verify, qa, release, builds>>
CreateDraft == QaPassed(build, verify, qa) /\ tag /\ release = "none" /\ release' = "draft"
               /\ UNCHANGED <<pr, main, build, verify, qa, tag, builds>>
\* release.mjs publish: needs a verified build that passed QA, and the draft.
Publish     == QaPassed(build, verify, qa) /\ tag /\ release = "draft" /\ release' = "published"
               /\ UNCHANGED <<pr, main, build, verify, qa, tag, builds>>

Command == OpenPr \/ ClosePr \/ MergePr \/ StartBuild \/ FinishBuild \/ Verify(TRUE) \/ Verify(FALSE)
           \/ Qa(TRUE) \/ Qa(FALSE) \/ PushTag \/ CreateDraft \/ Publish

Next ==
  /\ Command
  /\ phase' = PhaseOf(pr', main', build', verify', qa', release')
  /\ next' = NextOf(pr', main', build', verify', qa', tag', release')

Spec == Init /\ [][Next]_vars

\* Only so many builds: TLC explores no state past it.
Bounded == builds <= MaxBuilds

(* ---- what must hold ---- *)

TypeOK ==
  /\ pr \in {"none", "OPEN", "CLOSED", "MERGED"} /\ main \in BOOLEAN /\ tag \in BOOLEAN
  /\ release \in {"none", "draft", "published"}
  /\ phase = PhaseOf(pr, main, build, verify, qa, release) /\ next = NextOf(pr, main, build, verify, qa, tag, release)

\* A GitHub release is only made, or published, from a build that passed verify. (verify can run again later and
\* fail, as a launch probe that times out does; publish then refuses until it passes.)
ReleaseOnlyFromAVerifiedBuild == [][release' /= release => Verified(build, verify)]_vars
\* A GitHub release is only made, or published, from a build whose QA run found no blocker.
ReleaseOnlyFromAQaPassedBuild == [][release' /= release => QaPassed(build, verify, qa)]_vars
\* The DMG a release holds is never replaced.
ReleaseKeepsItsBuild == [][release /= "none" => build' = build]_vars
\* The brief status names can run now: its command is not refused.
TaskFor(t) == CASE t = Task.plan -> OpenPr [] t = Task.pr_open -> MergePr [] t = Task.pr_merged -> StartBuild \/ FinishBuild
                [] t = Task.built -> Verify(TRUE) \/ Verify(FALSE) [] t = Task.verified -> Qa(TRUE) \/ Qa(FALSE)
                [] t = Task.qa_passed -> PushTag \/ CreateDraft
                [] t = Task.staged -> Publish [] t = Task.published -> FALSE
NextCanRun == next = "done" \/ ENABLED TaskFor(next)
\* A release only goes back a phase for a closed pull request, a new build, a failed verify, or a QA blocker.
PhasesGoForward == [][Order(phase') >= Order(phase) \/ ClosePr \/ StartBuild \/ Verify(FALSE) \/ Qa(FALSE)]_vars
\* The release is done once published, and stays published.
StaysPublished == [][release = "published" => release' = "published"]_vars
=============================================================================
