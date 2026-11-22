# ViewHeader
Names the list on screen and holds its one primary action.

- Desktop (macOS, Windows, Linux): `view-title` (30px/650), subtitle in `muted` (Today shows the date; a project shows "Area: Home · Deadline Sat 12 Dec · 21 days left"), "New task" primary button on the right.
- Mobile (`large: true`, iOS, Android): `large-title` (32px/700) bottom-aligned in a 92px band; a pushed view adds a back button above it. iOS shows a chevron and the parent's name ("‹ Browse"); Android shows an arrow with no label, and the system back gesture does the same thing.
- When the view changes, re-render the header and list with `pt-view-in` (desktop, rise 6px) or `pt-push-in` (mobile pushed view, slide 24px from the right).
