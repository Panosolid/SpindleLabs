fix

- Opening and closing split view many times no longer makes the main 3D view go blank: each closed view now gives its graphics memory back.
- A long-session soak test drives the app through hundreds of sketch, extrude, edit, undo, split view, save and open cycles and fails if memory keeps growing; a short run is in the nightly testing.
