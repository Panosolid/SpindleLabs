fix

- With offline mode on, a tab still running the version before an update keeps finding its own files after another tab takes the update, so its geometry engine can restart instead of turning every item red.
- The AI panel no longer downloads the in-browser model's code just to find this browser has no WebGPU, and a page left open across an update says to reload instead of showing a raw loading error.
