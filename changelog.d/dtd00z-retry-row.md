none

- A feature that takes the geometry kernel too long is now marked red with "took too long" and a Retry button on its row (in the browser's Timeline, and in the bottom bar beside its ⋯ once you tap it), while the rest of the design is built again. It is not tried again by itself, so one stuck feature no longer stops the kernel over and over; Retry, or changing it or anything before it, tries it again.
- Bodies that are not on screen (hidden by their eye, or replaced by a Move) no longer keep their display mesh in the kernel, so big designs use less memory.
