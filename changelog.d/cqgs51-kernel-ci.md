none

- Testing: a new workflow runs the checks of the kernel's new private repository on this repository's runners, started from that repository for each of its pull requests. Its public log shows only one pass-or-fail line per check; the full logs go to a private results repository. A filter test (with a planted leak it must catch) guards what the log may show.
