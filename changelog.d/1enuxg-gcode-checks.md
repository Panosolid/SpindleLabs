none

- The print-file checker used to test sliced files is stricter: it now follows files that shift their coordinates or mix extruder modes the way the printer does, flags inch units, out-of-range temperatures and settings that change flow, speed or tool, and treats anything it could not follow as a failure.
