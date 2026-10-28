fix

- A centre arc whose end lands on its own start, or less than 0.001 mm from it (including a tiny typed arc angle), is now refused with a note instead of drawing an invisible arc that stopped the whole sketch from extruding.
- A centre arc ended on a point already on its circle now joins that point, so the outline closes there.
- Pressing Enter while a size box is red (like "12,5") no longer draws a line to wherever the mouse rests: nothing is placed and the keys go to the red box.
- An arc or circle drawn exactly on top of one already there is refused with a note, as a line on top of a line already was.
