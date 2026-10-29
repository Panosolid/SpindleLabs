fix

- A geometry engine that stops answering or crashes in the middle of an edit is started again by itself and the design is built again, instead of leaving the design stuck on "rebuilding" or asking you to reload.
- If the browser's storage stops answering, the app still opens (after a short wait) and says so, and a save that never finishes says your latest changes aren't stored yet instead of showing "Saving…" forever.
