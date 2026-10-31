none

- Nightly testing no longer files a vague "job failed" issue when only some mutation-testing legs found survivors: legs that finished clean count as clean.
- A test now checks that a split view passes the sketch's screen points and the origin's look through to the one 3D view.
- The random app tester no longer reports a wrong selection when Move or Rotate is open, where clicking a body row adds that body on purpose.
- Nightly mutation testing of reading Design files runs again, and 20 changes to that code no test noticed are now caught by new tests.
