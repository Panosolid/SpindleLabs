fix

- A body you name like an old automatic name ("Feature 1 (box)") keeps that name after you reopen the project or undo; only projects saved before this change get their old automatic names shortened.
- A damaged project file whose timeline items are missing their dependency list or where-it-came-from details is refused when opened, with a message naming the item, instead of opening and then breaking Design.
