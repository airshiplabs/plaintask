----------------------- MODULE DesktopSessionSettles -----------------------
(* Liveness for DesktopSession: once the person stops, the window settles.   *)
(* The person acts at most Acts times; the window's own steps are weakly     *)
(* fair. Then every behaviour ends Quiet: no add or rename stuck "saving",   *)
(* no read left in the queue, and no window left "starting".                 *)
EXTENDS DesktopSession

CONSTANT Acts
VARIABLE acts   \* how many times the person has acted

UserNext == Next /\ ~SystemNext

LiveInit == Init /\ acts = 0
LiveNext == \/ SystemNext /\ UNCHANGED acts
            \/ UserNext /\ acts < Acts /\ acts' = acts + 1
LiveSpec == LiveInit /\ [][LiveNext]_<<vars, acts>> /\ WF_<<vars, acts>>(SystemNext /\ UNCHANGED acts)

Settles == <>[]Quiet
=============================================================================
