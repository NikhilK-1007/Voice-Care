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
  let nativeListenerBound = false;

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
      return toUser(data.user);
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
      const user = toUser(data.user);
      if (fullName.trim()) user.name = fullName.trim();
      return {
        ...user,
        needsConfirmation: !data.session
      };
    }

    throw new Error('Sign up failed. Please try again.');
  }

  async function hasValidSession(sb) {
    try {
      const { data } = await sb.auth.getSession();
      if (data?.session?.access_token) return data.session;
    } catch {
      // Ignore read errors
    }
    return null;
  }

  async function syncSummaryToCloud(user, entry) {
    if (!user || user.mode !== 'supabase' || !isConfigured()) {
      return { ok: false, skipped: true };
    }

    const sb = await getClient();
    if (!sb) return { ok: false, error: 'Offline or Supabase unavailable.' };

    const session = await hasValidSession(sb);
    if (!session) {
      return { ok: false, authExpired: true, error: 'Sign-in session expired. Please sign in again.' };
    }

    try {
      // Columns that exist in the current schema (see supabase/schema.sql).
      const record = {
        id: entry.id,
        user_id: session.user?.id || user.uid,
        patient_name: entry.patientName || user.name || '',
        patient_text: entry.patientText || '',
        language: entry.language || 'en',
        language_label: entry.languageLabel || 'English',
        summary: entry.summary || {},
        metadata: entry.metadata || {},
        confirmed: Boolean(entry.confirmed),
        updated_at: entry.updatedAt || new Date().toISOString()
      };

      // Everything the app shows for a visit. These live in their own columns so
      // the doctor view, timeline and notes survive a reinstall or a new phone.
      const extended = {
        ...record,
        english_summary: entry.englishSummary || null,
        urgent_flags: Array.isArray(entry.urgentFlags) ? entry.urgentFlags : [],
        missing_info: Array.isArray(entry.missingInfo) ? entry.missingInfo : [],
        follow_up_answers: Array.isArray(entry.followUpAnswers) ? entry.followUpAnswers : [],
        quick_info: entry.quickInfo || {},
        reviewed_at: entry.reviewedAt || null,
        doctor_note: entry.doctorNote || '',
        prescribed_medicines: entry.prescribedMeds || '',
        next_visit_at: entry.nextVisitAt || null
      };

      let payload = extended;
      let { error } = await sb.from('summaries').upsert(payload, { onConflict: 'id' });

      // Older projects may not have run the newest migration yet. A missing
      // column must not stop the visit from being backed up, so drop the
      // optional columns and save the core record instead.
      if (error && /column|schema cache|PGRST204/i.test(error.message || '')) {
        console.warn('[VoiceCare Supabase] Extended columns missing, saving core fields.');
        payload = record;
        ({ error } = await sb.from('summaries').upsert(payload, { onConflict: 'id' }));
      }

      if (error) {
        // If RLS denies UPDATE during upsert on a fresh row, try plain INSERT
        if (/42501|row-level security|policy/i.test(error.message || '')) {
          const ins = await sb.from('summaries').insert(payload);
          if (!ins.error) return { ok: true };
        }
        console.warn('[VoiceCare Supabase] Cloud sync error:', error.message);
        return { ok: false, error: error.message };
      }
      return { ok: true };
    } catch (err) {
      console.warn('[VoiceCare Supabase] Cloud sync skipped:', err.message);
      return { ok: false, error: err.message };
    }
  }

  async function loadCloudSummaries(user) {
    if (!user || user.mode !== 'supabase' || !isConfigured()) {
      return { ok: false, skipped: true };
    }

    const sb = await getClient();
    if (!sb) return { ok: false, error: 'Offline or Supabase unavailable.' };

    const session = await hasValidSession(sb);
    if (!session) {
      return { ok: false, authExpired: true, error: 'Sign-in session expired. Please sign in again.' };
    }

    try {
      const uid = session.user?.id || user.uid;
      const { data, error } = await sb
        .from('summaries')
        .select('*')
        .eq('user_id', uid)
        .order('updated_at', { ascending: false });

      if (error || !data) {
        return { ok: false, error: error?.message || 'Could not load cloud summaries.' };
      }

      const items = data.map((row) => ({
        id: row.id,
        patientName: row.patient_name,
        patientText: row.patient_text,
        language: row.language,
        languageLabel: row.language_label,
        summary: row.summary,
        englishSummary: row.english_summary || null,
        urgentFlags: Array.isArray(row.urgent_flags) ? row.urgent_flags : [],
        missingInfo: Array.isArray(row.missing_info) ? row.missing_info : [],
        followUpAnswers: Array.isArray(row.follow_up_answers) ? row.follow_up_answers : [],
        quickInfo: row.quick_info || {},
        reviewedAt: row.reviewed_at || null,
        doctorNote: row.doctor_note || '',
        prescribedMeds: row.prescribed_medicines || '',
        nextVisitAt: row.next_visit_at || null,
        metadata: row.metadata,
        confirmed: row.confirmed,
        synced: true,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
      return { ok: true, items };
    } catch (err) {
      console.warn('[VoiceCare Supabase] Fetch summaries error:', err);
      return { ok: false, error: err.message };
    }
  }

  function compactReminder(rem) {
    return {
      id: String(rem.id || ''),
      n: String(rem.name || '').slice(0, 100),
      t: String(rem.time || '08:00').slice(0, 5),
      m: String(rem.timingTag || 'After breakfast').slice(0, 40),
      d: String(rem.dosageNote || '').slice(0, 120),
      a: rem.active !== false ? 1 : 0,
      td: String(rem.takenDate || '').slice(0, 32),
      u: String(rem.updatedAt || new Date().toISOString())
    };
  }

  function expandReminder(c) {
    if (!c || !c.id) return null;
    return {
      id: String(c.id),
      name: String(c.n ?? c.name ?? ''),
      time: String(c.t ?? c.time ?? '08:00'),
      timingTag: String(c.m ?? c.timingTag ?? 'After breakfast'),
      dosageNote: String(c.d ?? c.dosageNote ?? ''),
      active: c.a !== undefined ? Boolean(c.a) : c.active !== false,
      takenDate: String(c.td ?? c.takenDate ?? ''),
      updatedAt: String(c.u ?? c.updatedAt ?? '')
    };
  }

  /**
   * Syncs the signed-in user's medicine reminders to their Supabase user metadata
   * so reminders automatically transfer when they log in on any device.
   */
  async function syncRemindersToCloud(user, reminders = [], deletedIds = []) {
    if (!user || user.mode !== 'supabase' || !isConfigured()) {
      return { ok: false, skipped: true };
    }

    const sb = await getClient();
    if (!sb) return { ok: false, error: 'Offline or Supabase unavailable.' };

    const session = await hasValidSession(sb);
    if (!session) {
      return { ok: false, authExpired: true, error: 'Sign-in session expired. Please sign in again.' };
    }

    try {
      const payload = {
        items: (Array.isArray(reminders) ? reminders : []).slice(0, 40).map(compactReminder),
        deleted: (Array.isArray(deletedIds) ? deletedIds : []).slice(0, 30),
        updatedAt: new Date().toISOString()
      };
      const { error } = await sb.auth.updateUser({
        data: { voicecare_reminders_v2: payload }
      });
      if (error) {
        console.warn('[VoiceCare Supabase] Reminder sync error:', error.message);
        return { ok: false, error: error.message };
      }
      return { ok: true };
    } catch (err) {
      console.warn('[VoiceCare Supabase] Reminder sync skipped:', err.message);
      return { ok: false, error: err.message };
    }
  }

  /**
   * Fetches the user's cloud medicine reminders from Supabase Auth metadata.
   */
  async function loadCloudReminders(user) {
    if (!user || user.mode !== 'supabase' || !isConfigured()) {
      return { ok: false, skipped: true };
    }

    const sb = await getClient();
    if (!sb) return { ok: false, error: 'Offline or Supabase unavailable.' };

    const session = await hasValidSession(sb);
    if (!session) {
      return { ok: false, authExpired: true, error: 'Sign-in session expired. Please sign in again.' };
    }

    try {
      let sbUser = null;
      const { data: userData, error: userErr } = await sb.auth.getUser();
      if (!userErr && userData?.user) {
        sbUser = userData.user;
      } else {
        sbUser = session.user || null;
      }
      if (!sbUser) return { ok: false, authExpired: true, error: 'Sign-in session expired.' };

      const raw = sbUser.user_metadata?.voicecare_reminders_v2;
      if (!raw) {
        return { ok: true, items: [], deleted: [], updatedAt: '' };
      }
      const rawItems = Array.isArray(raw) ? raw : Array.isArray(raw.items) ? raw.items : [];
      const items = rawItems.map(expandReminder).filter((r) => r && r.name);
      const deleted = Array.isArray(raw.deleted) ? raw.deleted.map(String) : [];
      return {
        ok: true,
        items,
        deleted,
        updatedAt: String(raw.updatedAt || '')
      };
    } catch (err) {
      console.warn('[VoiceCare Supabase] Fetch reminders error:', err);
      return { ok: false, error: err.message };
    }
  }

  async function deleteCloudSummary(user, entryId) {
    if (!user || user.mode !== 'supabase' || !entryId || !isConfigured()) {
      return false;
    }

    const sb = await getClient();
    if (!sb) return false;

    try {
      const { error } = await sb
        .from('summaries')
        .delete()
        .eq('id', entryId)
        .eq('user_id', user.uid);
      if (error) {
        console.warn('[VoiceCare Supabase] Cloud delete error:', error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('[VoiceCare Supabase] Cloud delete skipped:', err.message);
      return false;
    }
  }

  /**
   * The quick-info card is account data, not visit data, so it is stored in the
   * user's Supabase profile metadata instead of a summaries row.
   */
  async function syncProfileToCloud(user, profile) {
    if (!user || user.mode !== 'supabase' || !isConfigured()) return { ok: false, skipped: true };
    const sb = await getClient();
    if (!sb) return { ok: false, error: 'Offline or Supabase unavailable.' };
    try {
      const { error } = await sb.auth.updateUser({
        data: { voicecare_profile: { ...(profile || {}), updatedAt: new Date().toISOString() } }
      });
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /** Reads the quick-info card saved on another phone, so it follows the account. */
  async function loadCloudProfile(user) {
    if (!user || user.mode !== 'supabase' || !isConfigured()) return { ok: false, skipped: true };
    const sb = await getClient();
    if (!sb) return { ok: false, error: 'Offline or Supabase unavailable.' };
    try {
      const { data, error } = await sb.auth.getUser();
      if (error || !data?.user) return { ok: false, error: error?.message || 'Not signed in.' };
      const profile = data.user.user_metadata?.voicecare_profile;
      return { ok: true, profile: profile && typeof profile === 'object' ? profile : null };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async function signOut() {
    if (!isConfigured()) return;
    const sb = await getClient();
    if (!sb) return;
    try {
      await sb.auth.signOut();
    } catch (err) {
      console.warn('[VoiceCare Supabase] Sign out warning:', err.message);
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

    if (!params.access_token && !params.refresh_token && !params.code) return;

    const sb = await getClient();
    if (!sb) return;

    const { data, error } = params.code
      ? await sb.auth.exchangeCodeForSession(params.code)
      : await sb.auth.setSession({
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
    if (nativeListenerBound) return;
    const App = window.Capacitor?.Plugins?.App;
    if (!App?.addListener) return;
    nativeListenerBound = true;
    App.addListener('appUrlOpen', (event) => {
      const url = event?.url || '';
      if (url.startsWith('in.voicecare.app://')) {
        completeNativeSignIn(url).catch((err) => console.warn('[VoiceCare Supabase] Deep link:', err.message));
      }
    });

    const Browser = window.Capacitor?.Plugins?.Browser;
    if (Browser?.addListener) {
      Browser.addListener('browserFinished', () => {
        if (!pendingNativeAuth) return;
        setTimeout(() => {
          if (pendingNativeAuth) {
            pendingNativeAuth.reject(new Error('Google sign-in was cancelled.'));
            pendingNativeAuth = null;
          }
        }, 1500);
      });
    }
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
    signOut,
    syncSummaryToCloud,
    deleteCloudSummary,
    loadCloudSummaries,
    syncProfileToCloud,
    loadCloudProfile,
    syncRemindersToCloud,
    loadCloudReminders
  };
})();
