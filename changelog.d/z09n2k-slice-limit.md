fix

- A big solid part sliced at high infill (a 246 mm box at 100 %) is no longer stopped with "took the geometry kernel too long": the slice time limit now counts the area to fill, not only the triangles.
- Download STL of several bodies now says they are separate shells in one file, and that two touching or overlapping bodies can make a file some slicers refuse (Slice for printing sends them one by one, which is safe).
- Slice for printing now tells you when bodies start at different heights: the lowest point goes on the plate, so a body above the others hangs in the air and only prints with supports on.
- A part floating above the plate, with supports off, is now refused in plain words that say how high it hangs, where, and what to do (turn Supports on, or move it down).
