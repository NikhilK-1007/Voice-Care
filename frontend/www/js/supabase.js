/**
 * VoiceCare Supabase Integration
 *
 * Handles Authentication (Email/Password Sign-In & Sign-Up)
 * and Cloud Sync for Doctor Consultation Summaries using Supabase.
 */

window.VOICECARE_SUPABASE = (() => {
  let client = null;
  let initialized = false;

  // Deep link the Android app listens for after Google sign-in (see AndroidManifest.xml).
  const NATIVE_AUTH_REDIRECT = 'in.voicecare.app://auth-callback';
  let pendingNativeAuth = null;
  let recoveryCallback = null;

  function isConfigured() {
    const cfg = window.VOICECARE_CONFIG?.SUPABASE_CONFIG;
    return Boolean(cfg && cfg.url && cfg.anonKey);
  }

  async function getClient() {
    if (client) return client;
    if (!isConfigured()) return null;

    try {
      if (!window.supabase) {
        // Load Supabase JS client dynamically if not already loaded
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
          script.onload = resolve;
          script.onerror = () => reject(new Error('Failed to load Supabase SDK from CDN'));
          document.head.appendChild(script);
        });
      }

      const cfg = window.VOICECARE_CONFIG.SUPABASE_CONFIG;
      client = window.supabase.createClient(cfg.url, cfg.anonKey);
      initialized = true;
      return client;
    } catch (err) {
      console.warn('[VoiceCare Supabase] Init error:', err);
      return null;
    }
  }

  async function signInWithEmail(email, password) {
    if (!isConfigured()) {
      throw new Error('Supabase is not configured yet. Please use Continue as Guest.');
    }

    const sb = await getClient();
    if (!sb) {
      throw new Error('Could not connect to Supabase service. Check internet connection.');
    }

    const { data, error } = await sb.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        throw new Error('Wrong email or password. Please try again or tap Forgot password.');
      }
      throw new Error(error.message);
    }

    if (data?.user) {
      return {
        uid: data.user.id,
        name: data.user.user_metadata?.full_name || email.split('@')[0],
        email: data.user.email,
        mode: 'supabase'
      };
    }

    throw new Error('Sign in failed. Please try again.');
  }

  async function resetPassword(email) {
    if (!isConfigured()) {
      throw new Error('Account service is not configured yet.');
    }

    const sb = await getClient();
    if (!sb) {
      throw new Error('Could not connect to account service. Check internet connection.');
    }

    const isNative = Boolean(window.Capacitor?.isNativePlatform?.());
    const redirectTo = isNative
      ? NATIVE_AUTH_REDIRECT
      : `${window.location.origin}${window.location.pathname}`;

    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) {
      throw new Error(error.message);
    }
    return true;
  }

  async function updatePassword(newPassword) {
    if (!isConfigured()) {
      throw new Error('Account service is not configured yet.');
    }

    const sb = await getClient();
    if (!sb) {
      throw new Error('Could not connect to account service. Check internet connection.');
    }

    const { data, error } = await sb.auth.updateUser({ password: newPassword });
    if (error) {
      throw new Error(error.message);
    }

    if (data?.user) {
      return toUser(data.user);
    }
    return null;
  }

  function onPasswordRecovery(callback) {
    recoveryCallback = callback;
    const params = parseAuthParams(window.location.href);
    if (params.type === 'recovery' && typeof callback === 'function') {
      callback();
    }
    getClient().then((sb) => {
      if (!sb) return;
      sb.auth.onAuthStateChange((event) => {
        if (event === 'PASSWORD_RECOVERY' && typeof recoveryCallback === 'function') {
          recoveryCallback();
        }
      });
    });
  }

  async function signUpWithEmail(email, password, fullName = '') {
    if (!isConfigured()) {
      throw new Error('Supabase is not configured yet. Please use Continue as Guest.');
    }

    const sb = await getClient();
    if (!sb) {
      throw new Error('Could not connect to Supabase service. Check internet connection.');
    }

    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName.trim() || email.split('@')[0]
        }
      }
    });

    if (error) {
      if (error.message.includes('already registered')) {
        throw new Error('An account already exists with this email. Please switch to Sign in.');
      }
      throw new Error(error.message);
    }

    if (data?.user) {
      return {
        uid: data.user.id,
        name: fullName.trim() || email.split('@')[0],
        email: data.user.email,
        mode: 'supabase'
      };
    }

    throw new Error('Sign up failed. Please try again.');
  }

  async function syncSummaryToCloud(user, entry) {
    if (!user || user.mode !== 'supabase' || !isConfigured()) {
      return false;
    }

    const sb = await getClient();
    if (!sb) return false;

    try {
      const record = {
        id: entry.id,
        user_id: user.uid,
        patient_name: entry.patientName || user.name || '',
        patient_text: entry.patientText || '',
        language: entry.language || 'en',
        language_label: entry.languageLabel || 'English',
        summary: entry.summary || {},
        metadata: entry.metadata || {},
        confirmed: Boolean(entry.confirmed),
        updated_at: new Date().toISOString()
      };

      const { error } = await sb.from('summaries').upsert(record);
      if (error) {
        console.warn('[VoiceCare Supabase] Cloud sync error:', error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('[VoiceCare Supabase] Cloud sync skipped:', err.message);
      return false;
    }
  }

  async function loadCloudSummaries(user) {
    if (!user || user.mode !== 'supabase' || !isConfigured()) {
      return [];
    }

    const sb = await getClient();
    if (!sb) return [];

    try {
      const { data, error } = await sb
        .from('summaries')
        .select('*')
        .order('updated_at', { ascending: false });

      if (error || !data) return [];

      return data.map((row) => ({
        id: row.id,
        patientName: row.patient_name,
        patientText: row.patient_text,
        language: row.language,
        languageLabel: row.language_label,
        summary: row.summary,
        metadata: row.metadata,
        confirmed: row.confirmed,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    } catch (err) {
      console.warn('[VoiceCare Supabase] Fetch summaries error:', err);
      return [];
    }
  }

  function toUser(sbUser) {
    return {
      uid: sbUser.id,
      name:
        sbUser.user_metadata?.full_name ||
        sbUser.user_metadata?.name ||
        (sbUser.email ? sbUser.email.split('@')[0] : 'Patient'),
      email: sbUser.email || '',
      mode: 'supabase'
    };
  }

  function parseAuthParams(url) {
    const hashIndex = url.indexOf('#');
    const queryIndex = url.indexOf('?');
    const raw =
      hashIndex >= 0
        ? url.slice(hashIndex + 1)
        : queryIndex >= 0
          ? url.slice(queryIndex + 1)
          : '';

    const params = {};
    raw
      .split('&')
      .filter(Boolean)
      .forEach((pair) => {
        const [key, value] = pair.split('=');
        params[decodeURIComponent(key)] = decodeURIComponent(value || '');
      });
    return params;
  }

  async function completeNativeSignIn(url) {
    const params = parseAuthParams(url);

    if (params.error_description || params.error) {
      const message = decodeURIComponent(
        (params.error_description || params.error || '').replace(/\+/g, ' ')
      );
      if (pendingNativeAuth) {
        pendingNativeAuth.reject(new Error(message));
        pendingNativeAuth = null;
      }
      return;
    }

    if (!params.access_token || !params.refresh_token) return;

    const sb = await getClient();
    if (!sb) return;

    const { data, error } = await sb.auth.setSession({
      access_token: params.access_token,
      refresh_token: params.refresh_token
    });

    if (error || !data?.user) {
      if (pendingNativeAuth) {
        pendingNativeAuth.reject(new Error(error?.message || 'Google sign-in could not be completed.'));
        pendingNativeAuth = null;
      }
      return;
    }

    const user = toUser(data.user);

    if (params.type === 'recovery') {
      try {
        await window.Capacitor?.Plugins?.Browser?.close?.();
      } catch {
        // Ignore if browser already closed
      }
      if (typeof recoveryCallback === 'function') {
        recoveryCallback();
      }
      return;
    }

    window.VOICECARE_STORAGE?.setUser?.(user);

    if (pendingNativeAuth) {
      pendingNativeAuth.resolve(user);
      pendingNativeAuth = null;
    }
  }

  function listenForNativeAuth() {
    const App = window.Capacitor?.Plugins?.App;
    if (!App?.addListener) return;
    App.addListener('appUrlOpen', (event) => {
      const url = event?.url || '';
      if (url.startsWith('in.voicecare.app://')) {
        completeNativeSignIn(url).catch((err) => console.warn('[VoiceCare Supabase] Deep link:', err.message));
      }
    });
  }

  /**
   * Google sign-in through Supabase's OAuth provider.
   * Native: opens the system browser and returns when the app is re-opened by
   * the `in.voicecare.app://auth-callback` deep link.
   * Web: redirects the page; Supabase restores the session on return.
   * Resolves to a VoiceCare user object, or null when the browser is navigating away.
   */
  async function signInWithGoogle() {
    if (!isConfigured()) {
      throw new Error('Sign-in is not configured yet. Please use Continue as Guest.');
    }

    const sb = await getClient();
    if (!sb) {
      throw new Error('Could not connect to the sign-in service. Check the internet connection.');
    }

    const isNative = Boolean(window.Capacitor?.isNativePlatform?.());

    if (isNative) {
      listenForNativeAuth();

      const { data, error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: NATIVE_AUTH_REDIRECT,
          skipBrowserRedirect: true,
          queryParams: { prompt: 'select_account' }
        }
      });

      if (error) throw new Error(error.message);
      if (!data?.url) throw new Error('Could not start Google sign-in.');

      const Browser = window.Capacitor?.Plugins?.Browser;
      if (!Browser?.open) {
        throw new Error('The in-app browser is unavailable. Reinstall the app and try again.');
      }

      await Browser.open({ url: data.url });

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (pendingNativeAuth) {
            pendingNativeAuth = null;
            reject(new Error('Google sign-in timed out. Please try again.'));
          }
        }, 180000);

        pendingNativeAuth = {
          resolve: (user) => {
            clearTimeout(timer);
            resolve(user);
          },
          reject: (err) => {
            clearTimeout(timer);
            reject(err);
          }
        };
      });
    }

    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}${window.location.pathname}`,
        queryParams: { prompt: 'select_account' }
      }
    });

    if (error) throw new Error(error.message);

    // The browser is leaving for Google; the session is restored on return.
    return null;
  }

  /** Returns the signed-in user after a page reload / OAuth redirect, or null. */
  async function restoreSession() {
    if (!isConfigured()) return null;
    const sb = await getClient();
    if (!sb) return null;

    try {
      const { data } = await sb.auth.getSession();
      if (data?.session?.user) return toUser(data.session.user);
    } catch (err) {
      console.warn('[VoiceCare Supabase] Session restore failed:', err.message);
    }
    return null;
  }

  function listenForDeepLinks() {
    if (window.Capacitor?.isNativePlatform?.()) listenForNativeAuth();
  }

  listenForDeepLinks();

  return {
    isConfigured,
    getClient,
    signInWithEmail,
    signUpWithEmail,
    resetPassword,
    updatePassword,
    onPasswordRecovery,
    signInWithGoogle,
    restoreSession,
    syncSummaryToCloud,
    loadCloudSummaries
  };
})();
