// The one switch for offline mode (the installable, offline-capable app:
// service worker, install prompt, "new version is ready" notice). Off until
// it is released (around fillets): flip OFFLINE_MODE to true and nothing
// else needs to change. SPINDLE_OFFLINE=1 at build time turns it on without
// editing this file (the offline browser check builds that way).
export const OFFLINE_MODE = process.env.SPINDLE_OFFLINE === "1" || false;
