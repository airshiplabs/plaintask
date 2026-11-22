# TabBar
The mobile app's four tabs on iOS and Android: Inbox, Today, Upcoming, Browse.

- Browse holds Anytime, Someday, Completed, Trash and every project; opening one pushes it with a back button ("‹ Browse") and keeps Browse current in the tab bar.
- Current tab: `accent` icon and label, the icon lifts 1px and grows 8% on `--ease-spring`. Others `muted`.
- 24px icons, `tab-label` text. Bottom padding is the safe-area inset (the iOS home indicator, Android gesture bar), at least 8px.
- Android (`data-platform="android"`): the current tab's icon sits in an `accent-soft` pill, as Android's navigation bar does; the icon does not lift. Tabs are at least `size-target` tall on touch screens.
