fix

- A shape typed side by side (an equilateral triangle, a 25.4 mm square from a decimal start) now closes on its first corner instead of leaving a second point on top of it.
- A rectangle drawn beside another shares their common side instead of drawing a second line on top of it, which broke the outline.
- Pressing Undo straight after a click in a sketch no longer shows a page error or brings the undone click back.
- On a phone, the AI panel and the Browser or Properties sheet no longer open on top of each other, and a tap on the view puts the AI panel away.
- A sketch started with the phone sideways keeps its plane prompt when the phone is turned upright, and Escape in the Menu no longer also cancels that prompt.
- An open dropdown moves with the window when the screen turns or resizes.
- With the AI panel open in a narrow window, the panels no longer cover the browser rows or the view buttons, and the guide's Close button fits on a 320 px screen.
- If the geometry kernel's file fails to download, the app now says so in plain words instead of showing raw browser text like "Failed to fetch".
- Names in an opened project follow the same rules as Rename: duplicates get a number, empty names get the next free name, over-long names are cut to 40 characters, and a name that isn't text is refused.
- "Café" typed two different ways on the keyboard now counts as the same name.
- A project file whose Design version is written as text says so with the value in quotes.
