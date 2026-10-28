fix

- Two tabs on one project no longer lose work: a tab closed mid-save no longer puts older work back over newer work, and a tab that is out of date says the project changed in another tab instead of overwriting it.
- Undoing back to the saved state just before opening another project no longer stores the undone state.
- The AI preview now says when a box after an extrude is added as a new body, matching what Accept does, and the AI can no longer draw circles or rectangles bigger or smaller than the size boxes allow.
- Random testing and fuzzing keep the private checker's error messages out of their public logs, and several test checks that could never fail now can.
