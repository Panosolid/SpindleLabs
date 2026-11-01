fix

- A phone or laptop that sleeps (or a tab left in the background) while the geometry kernel is working no longer makes Design say the step "took too long" and rebuild everything; the step gets its time again when the device wakes.
- Badly formed requests now get the kernel's normal "bad request" answer instead of a crash while its time limit is worked out.
- The saved-file notes now list every field of a face sketch, and a test stops a new saved field from landing without a note (and a version change when needed).
- The check that keeps private names out of public files now also catches the hyphen and underscore spellings.
