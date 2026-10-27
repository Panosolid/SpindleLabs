One file per pull request: this folder holds the changelog entries that have
not been folded into CHANGELOG.md yet. A pull request never writes a version
number; it adds one file here, named so no other pull request uses it (its
branch's last part and a word or two, like ev4faw-version-bot.md):

    fix

    - Fixed: what was broken, how it was found and how it was checked.

First line: `fix` (the bug-fix number goes up by one), `step N` (the first
piece of CAD step N: the version becomes 0.N.0) or `none` (anything else).
Then a blank line and the entry, "- " lines in plain words.

The numbers come from the order the pull requests reached main
(.github/scripts/changelog.py, which says how; `changelog.py show` prints the
whole changelog numbered). Never edit a fragment once it is on main.
