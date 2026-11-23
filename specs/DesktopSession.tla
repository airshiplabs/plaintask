--------------------------- MODULE DesktopSession ---------------------------
(***************************************************************************)
(* The desktop window's session: what it shows, the new-task form, a      *)
(* rename, and the queue of reads and saves of Inbox.md behind them.      *)
(*                                                                         *)
(* Code: apps/desktop/src/session.ts holds the five session variables and *)
(* the transitions on them; apps/desktop/src/app.ts calls them. The queue  *)
(* is app.ts's inTurn(): one read or save of Inbox.md at a time, in the    *)
(* order asked. An edit's caller goes on only once the queue is empty      *)
(* (edit() in app.ts), so its add or rename settles in a step of its own.  *)
(* Every step is one JavaScript task: microtasks between two awaits of the *)
(* backend run with no event in between.                                   *)
(*                                                                         *)
(* tests/spec-desktop-session.test.mjs fails when session.ts and this spec *)
(* disagree on any transition TLC explores here.                           *)
(***************************************************************************)
EXTENDS Naturals, Sequences

CONSTANT MaxQueue   \* the longest queue the model explores

Views    == {"starting", "choose", "folderError", "inbox", "gone", "unreadable"}
Turns    == {"load", "redraw", "add", "rename", "row"}        \* "row": a tick or an Undo

VARIABLES
  view,       \* what the list area shows
  chosen,     \* a folder is chosen, so Inbox.md is read again when the window regains focus
  composer,   \* the new-task form: "closed" or "open"
  adding,     \* a new task is on its way to the file
  rename,     \* "none", "editing" (the title is a field), or "saving"
  queue,      \* reads and saves of Inbox.md not yet done, oldest first
  addDone,    \* the add is saved and waits for the queue to empty
  renameDone  \* the rename is saved and waits for the queue to empty

session == <<view, chosen, composer, adding, rename>>
vars    == <<view, chosen, composer, adding, rename, queue, addDone, renameDone>>

TypeOK ==
  /\ view \in Views
  /\ chosen \in BOOLEAN
  /\ composer \in {"closed", "open"}
  /\ adding \in BOOLEAN
  /\ rename \in {"none", "editing", "saving"}
  /\ queue \in Seq(Turns) /\ Len(queue) <= MaxQueue
  /\ addDone \in BOOLEAN
  /\ renameDone \in BOOLEAN

Init ==
  /\ view = "starting" /\ chosen = FALSE /\ composer = "closed" /\ adding = FALSE /\ rename = "none"
  /\ queue = <<>> /\ addDone = FALSE /\ renameDone = FALSE

Room == Len(queue) < MaxQueue
Ask(turn) == queue' = Append(queue, turn)
Up(turn) == queue /= <<>> /\ Head(queue) = turn
Done == queue' = Tail(queue)
Then(turn) == queue' = Append(Tail(queue), turn)   \* this turn is done, and its failure asks for another

\* A notice in place of the list. It closes the form and takes away a title being edited with the rows.
Notice(kind) ==
  /\ view' = kind
  /\ composer' = "closed"
  /\ rename' = IF rename = "editing" THEN "none" ELSE rename

(* ---- starting: the folder the app remembers ---- *)

FolderFound  == view = "starting" /\ ~chosen /\ queue = <<>> /\ chosen' = TRUE /\ Ask("load")
                /\ UNCHANGED <<view, composer, adding, rename, addDone, renameDone>>
FolderNone   == view = "starting" /\ ~chosen /\ queue = <<>> /\ view' = "choose"
                /\ UNCHANGED <<chosen, composer, adding, rename, queue, addDone, renameDone>>
FolderFailed == view = "starting" /\ ~chosen /\ queue = <<>> /\ view' = "folderError"
                /\ UNCHANGED <<chosen, composer, adding, rename, queue, addDone, renameDone>>

(* ---- the person ---- *)

\* The result of the folder panel, opened from a notice. A read queued before may have drawn the list meanwhile.
FolderPicked == view /= "starting" /\ Room /\ chosen' = TRUE /\ Ask("load")
                /\ UNCHANGED <<view, composer, adding, rename, addDone, renameDone>>
Focus        == chosen /\ rename = "none" /\ Room /\ Ask("load")
                /\ UNCHANGED <<session, addDone, renameDone>>
OpenComposer == view = "inbox" /\ composer = "closed" /\ rename /= "editing" /\ composer' = "open"
                /\ UNCHANGED <<view, chosen, adding, rename, queue, addDone, renameDone>>
CloseComposer == composer = "open" /\ composer' = "closed"
                /\ UNCHANGED <<view, chosen, adding, rename, queue, addDone, renameDone>>
StartAdd     == composer = "open" /\ ~adding /\ rename /= "editing" /\ Room /\ adding' = TRUE /\ Ask("add")
                /\ UNCHANGED <<view, chosen, composer, rename, addDone, renameDone>>
StartRename  == view = "inbox" /\ rename = "none" /\ rename' = "editing"
                /\ UNCHANGED <<view, chosen, composer, adding, queue, addDone, renameDone>>
KeepRename   == rename = "editing" /\ rename' = "none"
                /\ UNCHANGED <<view, chosen, composer, adding, queue, addDone, renameDone>>
SaveRename   == rename = "editing" /\ Room /\ rename' = "saving" /\ Ask("rename")
                /\ UNCHANGED <<view, chosen, composer, adding, addDone, renameDone>>
\* A tick, or an Undo from a toast, which stays up over a notice. Neither changes the session. A row was
\* only ever drawn from a chosen folder.
EditRow      == chosen /\ view /= "starting" /\ Room /\ Ask("row")
                /\ UNCHANGED <<session, addDone, renameDone>>

(* ---- the queue: a read ---- *)

\* The list is drawn from the file. Drawn again without the row whose title is a field, the field goes with the
\* row: app.ts then keeps the old title, which is KeepRename.
Shown == \E turn \in {"load", "redraw"} : Up(turn) /\ Done /\ view' = "inbox"
         /\ UNCHANGED <<chosen, composer, adding, rename, addDone, renameDone>>
LoadGone       == \E turn \in {"load", "redraw"} : Up(turn) /\ Done /\ Notice("gone")
                  /\ UNCHANGED <<chosen, adding, addDone, renameDone>>
LoadUnreadable == \E turn \in {"load", "redraw"} : Up(turn) /\ Done /\ Notice("unreadable")
                  /\ UNCHANGED <<chosen, adding, addDone, renameDone>>

(* ---- the queue: a save. Each reads the file first; null there is a folder that is gone. ---- *)

AddOk     == Up("add") /\ Done /\ addDone' = TRUE /\ UNCHANGED <<session, renameDone>>
AddFailed == Up("add") /\ Then("load") /\ adding' = FALSE
             /\ UNCHANGED <<view, chosen, composer, rename, addDone, renameDone>>
AddGone   == Up("add") /\ Then("load") /\ adding' = FALSE /\ Notice("gone")
             /\ UNCHANGED <<chosen, addDone, renameDone>>
\* Once the queue is empty: the form closes, and the new row is drawn when the list is shown.
AddSettled == adding /\ addDone /\ queue = <<>> /\ adding' = FALSE /\ addDone' = FALSE /\ composer' = "closed"
             /\ UNCHANGED <<view, chosen, rename, queue, renameDone>>

RenameOk     == Up("rename") /\ Done /\ renameDone' = TRUE /\ UNCHANGED <<session, addDone>>
RenameFailed == Up("rename") /\ Then("redraw") /\ rename' = "none"
                /\ UNCHANGED <<view, chosen, composer, adding, addDone, renameDone>>
RenameGone   == Up("rename") /\ Then("redraw") /\ Notice("gone") /\ rename' = "none"
                /\ UNCHANGED <<chosen, adding, addDone, renameDone>>
RenameSettled == rename = "saving" /\ renameDone /\ queue = <<>> /\ rename' = "none" /\ renameDone' = FALSE
                /\ UNCHANGED <<view, chosen, composer, adding, queue, addDone>>

RowOk     == Up("row") /\ Done /\ UNCHANGED <<session, addDone, renameDone>>
RowFailed == Up("row") /\ Then("redraw") /\ UNCHANGED <<session, addDone, renameDone>>
RowGone   == Up("row") /\ Then("redraw") /\ Notice("gone")
             /\ UNCHANGED <<chosen, adding, addDone, renameDone>>

Next ==
  \/ FolderFound \/ FolderNone \/ FolderFailed
  \/ FolderPicked \/ Focus \/ OpenComposer \/ CloseComposer \/ StartAdd
  \/ StartRename \/ KeepRename \/ SaveRename \/ EditRow
  \/ Shown \/ LoadGone \/ LoadUnreadable
  \/ AddOk \/ AddFailed \/ AddGone \/ AddSettled
  \/ RenameOk \/ RenameFailed \/ RenameGone \/ RenameSettled
  \/ RowOk \/ RowFailed \/ RowGone

Spec == Init /\ [][Next]_vars

(* ---- what must hold ---- *)

\* The form and a title field only show over the list, never over a notice.
FormOnlyOverTheList  == composer = "open" => view = "inbox"
FieldOnlyOverTheList == rename = "editing" => view = "inbox"
\* "adding" and "saving" are true exactly while their save is queued or waits for the queue to empty:
\* neither can stick and block the next add or rename, and neither can end while its save is still to come.
AddingMeansAnAdd     == adding <=> (\E i \in 1..Len(queue) : queue[i] = "add") \/ addDone
SavingMeansARename   == (rename = "saving") <=> (\E i \in 1..Len(queue) : queue[i] = "rename") \/ renameDone
AtMostOneAdd         == \A i, j \in 1..Len(queue) : queue[i] = "add" /\ queue[j] = "add" => i = j
\* A read is only ever asked for once a folder is chosen.
ReadsNeedAFolder     == (\E i \in 1..Len(queue) : queue[i] \in {"load", "redraw"}) => chosen

\* The steps the window takes on its own, as opposed to the person's.
SystemNext == FolderFound \/ FolderNone \/ FolderFailed
              \/ Shown \/ LoadGone \/ LoadUnreadable
              \/ AddOk \/ AddFailed \/ AddGone \/ AddSettled
              \/ RenameOk \/ RenameFailed \/ RenameGone \/ RenameSettled
              \/ RowOk \/ RowFailed \/ RowGone
\* Nothing is left to do: no save or read to come, and the window shows the list or a notice.
Quiet == queue = <<>> /\ ~adding /\ rename /= "saving" /\ view /= "starting"
=============================================================================
