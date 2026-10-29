fix

- The private engine's checks build a release again: since the last CI change they had been failing on every engine pull request without a real fault.
- The merge tests run correctly on their own again, and a check keeps every test file that way.
