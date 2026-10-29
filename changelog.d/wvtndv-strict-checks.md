fix

- The nightly testing now files an issue for every kind of failure, not only for failing seeds: a journey that fails, an unexplained mutant, a mutation run that stopped, a fuzzer that crashed or ran out of time, and any other job that went red.
- New tests check that an Extrude or Edit feature started on a design that then changed, or was cancelled, while the kernel was busy records nothing.
