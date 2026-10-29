fix

- A last project the app couldn't open is tried again on the next reload, instead of being replaced by an empty project nobody changed.
- Two tabs opened together (a restored session, a bookmark clicked twice) both open your project, instead of the second one saying it didn't finish opening and starting a new one.
- Locking the phone or switching apps just after a project opens, then the phone closing the tab in the background, no longer makes the next visit skip that project and start an empty one.
