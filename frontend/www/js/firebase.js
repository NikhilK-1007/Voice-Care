/**
 * VoiceCare Optional Firebase Integration (Phase 2)
 *
 * Works seamlessly in two modes:
 * 1. Guest Demo / Offline Mode (default when FIREBASE_CONFIG.apiKey is empty)
 * 2. Cloud Mode (when Firebase config is added in config.js)
 */

window.VOICECARE_FIREBASE = (() => {
  let firebaseApp = null;
  let auth = null;
  let db = null;
  let initialized = false;

  function isConfigured() {
    const cfg = window.VOICECARE_CONFIG?.FIREBASE_CONFIG;
    return Boolean(cfg && cfg.apiKey && cfg.projectId);
  }

  async function init() {
    if (initialized && auth) {
      return true;
    }
    if (!isConfigured()) {
      return false;
    }

    try {
      // Dynamically load Firebase modular SDK only if user configured Firebase keys
      const [{ initializeApp, getApps }, authMod, firestoreMod] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js'),
        import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js')
      ]);

      const apps = getApps();
      firebaseApp = apps.length > 0 ? apps[0] : initializeApp(window.VOICECARE_CONFIG.FIREBASE_CONFIG);
      auth = authMod.getAuth(firebaseApp);
      db = firestoreMod.getFirestore(firebaseApp);
      initialized = true;
      return true;
    } catch (err) {
      console.warn('[VoiceCare Firebase] Could not initialize cloud SDK:', err);
      throw new Error(`Could not connect to authentication service: ${err.message}`);
    }
  }

  async function signInWithEmail(email, password) {
    if (!isConfigured()) {
      throw new Error('Account login is not configured yet. Please use Continue as Guest.');
    }

    const ok = await init();
    if (!ok || !auth) {
      throw new Error('Could not initialize login service. Please check your internet connection.');
    }

    const authMod = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js');
    try {
      const cred = await authMod.signInWithEmailAndPassword(auth, email, password);
      return {
        uid: cred.user.uid,
        name: cred.user.displayName || email.split('@')[0],
        email: cred.user.email,
        mode: 'firebase'
      };
    } catch (err) {
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
        try {
          const cred = await authMod.createUserWithEmailAndPassword(auth, email, password);
          return {
            uid: cred.user.uid,
            name: email.split('@')[0],
            email: cred.user.email,
            mode: 'firebase'
          };
        } catch (createErr) {
          if (createErr.code === 'auth/email-already-in-use') {
            throw new Error('Incorrect password for this email. Please try again.');
          }
          throw createErr;
        }
      }
      throw err;
    }
  }

  async function syncSummaryToCloud(user, entry) {
    if (!user || user.mode !== 'firebase' || !initialized || !db) {
      return false;
    }
    try {
      const firestoreMod = await import(
        'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js'
      );
      const ref = firestoreMod.doc(db, 'users', user.uid, 'summaries', entry.id);
      await firestoreMod.setDoc(ref, entry);
      return true;
    } catch (err) {
      console.warn('[VoiceCare Firebase] Cloud sync skipped:', err.message);
      return false;
    }
  }

  return {
    isConfigured,
    init,
    signInWithEmail,
    syncSummaryToCloud
  };
})();
