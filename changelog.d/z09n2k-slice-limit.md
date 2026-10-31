fix

- A big solid part sliced at high infill (a 246 mm box at 100 %) is no longer stopped with "took the geometry kernel too long": the slice time limit now counts the area to fill, not only the triangles.
- Download STL of several bodies now says they are separate shells in one file, and that two touching or overlapping bodies can make a file some slicers refuse (Slice for printing sends them one by one, which is safe).
