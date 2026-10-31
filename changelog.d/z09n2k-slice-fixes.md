fix

- Saving a print file on a phone, Safari or Firefox: the "Name this file" box no longer opens hidden behind the Slice dialog (it could not be typed in, and the dialog stayed on "Slicing…").
- Opening the print preview many times no longer turns the 3D view blank: each preview now gives its graphics memory back.
- The print preview now shows the file that Slice and download saves (its time, plastic and start routine), not the plain G-code.
- Closing the Slice dialog while it is slicing now cancels the save or preview; Preview is off while a slice runs; changing a choice clears the old result; reopening mid-slice still says "Slicing…".
- A part too big for the plate now says how big it is and what the P1S takes, in plain words. The print preview keeps its layers, plastic and time on a phone, and its supports chip reads "Support (none)".
