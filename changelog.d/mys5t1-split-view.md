fix

- Opening and closing split view many times no longer makes the main 3D view go blank: each closed view now gives its graphics memory back.
- Closing the guide, or a split view showing the design, now frees its memory instead of keeping it for the rest of the session.
- A long-session soak test drives the app through hundreds of sketch, extrude, edit, undo, split view, save and open cycles and fails if memory keeps growing; a short run is in the nightly testing.
