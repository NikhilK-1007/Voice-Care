/**
 * VoiceCare Main Application Controller
 *
 * Manages all 12 screens, multilingual patient input (typed or in-app voice),
 * AI summary generation & editing, PDF sharing, reminders, and accessibility.
 */

(() => {
  const SCREENS = {
    splash: { title: 'VoiceCare', topbar: false, bottomNav: false },
    auth: { title: 'Sign in', topbar: false, bottomNav: false },
    home: { title: 'VoiceCare Home', topbar: false, bottomNav: true, back: false },
    language: { title: 'Select Language', topbar: false, bottomNav: false },
    input: { title: 'Describe Health Concern', topbar: false, bottomNav: true },
    processing: { title: 'Preparing Summary', topbar: false, bottomNav: false },
    summary: { title: 'Health Summary', topbar: false, bottomNav: false },
    edit: { title: 'Edit Summary', topbar: false, bottomNav: false },
    pdf: { title: 'PDF Preview & Share', topbar: false, bottomNav: false },
    profile: { title: 'My Information', topbar: false, bottomNav: true },
    followup: { title: 'Follow-up Questions', topbar: false, bottomNav: false },
    history: { title: 'Patient History', topbar: false, bottomNav: true },
    about: { title: 'Safety & Accessibility', topbar: false, bottomNav: true }
  };

  const state = {
    currentScreen: 'splash',
    historyStack: [],
    language: window.VOICECARE_STORAGE.getLanguage(),
    user: window.VOICECARE_STORAGE.getUser(),
    accessibility: window.VOICECARE_STORAGE.getAccessibility(),
    currentEntry: null,
    activeRequestId: 0,
    activeSummaryAbortController: null,
    healthWarmed: false,
    syncing: false,
    lastSyncAt: 0,
    syncStatusText: '',
    // Follow-up step: the description waiting to be summarised and the answers
    // the patient gave (skipped questions contribute nothing).
    pendingPatientText: '',
    pendingFollowUpAnswers: [],
    followUpQuestions: []
  };

  // DOM helpers
  const $ = (id) => document.getElementById(id);

  let toastTimer = null;
  function showToast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sanitizeInput(value, maxLen = 200) {
    return String(value ?? '')
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .trim()
      .slice(0, maxLen);
  }

  function applyAccessibility() {
    const acc = state.accessibility;
    const size = acc.textSize || 'large';
    document.body.classList.remove('text-standard', 'text-large', 'text-xl');
    document.body.classList.add(`text-${size}`);
    document.body.classList.toggle('high-contrast', Boolean(acc.highContrast));
    document.body.classList.toggle('reduced-motion', Boolean(acc.reducedMotion));

    $('acc-text-size').value = size;
    $('acc-high-contrast').checked = Boolean(acc.highContrast);
    $('acc-reduced-motion').checked = Boolean(acc.reducedMotion);

    document.querySelectorAll('[data-text-size]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-text-size') === size);
    });
  }

  function getTimeGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

  function getInitials(name) {
    const cleaned = String(name || '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .trim();
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (!parts.length) return 'VC';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function applyLanguage() {
    const lang = state.language;
    const t = window.VOICECARE_I18N[lang] || window.VOICECARE_I18N.en;

    // Update topbar language pill
    $('btn-lang-pill').textContent = t.nativeName;

    // Splash & Home texts
    $('splash-tagline').textContent = t.tagline;
    const namePart = state.user?.name ? `, ${state.user.name}` : '';
    const timeLabel = $('home-time-label');
    if (timeLabel) timeLabel.textContent = getTimeGreeting();
    $('home-greeting').textContent = `${t.greeting}${namePart}`;
    const avatarBtn = $('home-avatar-btn');
    if (avatarBtn) avatarBtn.textContent = getInitials(state.user?.name);
    $('home-subtitle').textContent = t.homeSubtitle;
    const homeDescribeBtn = $('btn-home-describe');
    if (homeDescribeBtn) {
      const label = lang === 'en' || lang === 'auto' ? 'Start speaking' : t.voiceStart || 'Start speaking';
      homeDescribeBtn.innerHTML = `<svg class="icon icon-sm" aria-hidden="true"><use href="#i-mic"></use></svg> ${escapeHtml(label)}`;
    }
    $('home-active-lang-label').textContent = t.nativeName;
    const settingsLangVal = $('settings-lang-value');
    if (settingsLangVal) settingsLangVal.textContent = t.nativeName;

    // Voice input copy (the recorder reads the same keys)
    const voiceTitle = $('voice-title');
    if (voiceTitle) voiceTitle.textContent = t.voiceTitle || t.voiceStart || 'Tap to speak';
    const voiceSub = $('voice-sub');
    if (voiceSub && t.voiceSub) {
      voiceSub.innerHTML = `<svg class="icon icon-sm" aria-hidden="true"><use href="#i-lock"></use></svg> ${escapeHtml(t.voiceSub)}`;
    }
    const inputPageSub = $('input-page-sub');
    if (inputPageSub && t.inputPageSub) inputPageSub.textContent = t.inputPageSub;
    window.VOICECARE_VOICE?.refreshLabels?.();
    const inputBox = $('patient-input-box');
    // "auto" means the patient may use any language; keep an English UI hint.
    inputBox.setAttribute('lang', lang === 'auto' ? 'en' : lang);
    inputBox.placeholder = t.inputPlaceholder;
    const inputLangNote = $('input-lang-note');
    if (inputLangNote && t.inputLangNote) inputLangNote.textContent = t.inputLangNote;
    const langContinueBtn = $('btn-lang-continue');
    if (langContinueBtn && t.langContinueBtn) langContinueBtn.textContent = t.langContinueBtn;
    $('btn-generate-summary').innerHTML = `<svg class="icon icon-sm" aria-hidden="true"><use href="#i-sparkles"></use></svg> ${escapeHtml(t.generateBtn)}`;
    $('btn-clear-input').textContent = t.clearBtn;
    $('input-lang-indicator').textContent = t.nativeName;
    $('input-disclaimer').textContent = t.disclaimerShort;

    // Processing & Bottom Nav labels
    $('processing-title').textContent = t.processingTitle;
    $('processing-subtitle').textContent = t.processingSubtitle;
    $('nav-label-home').textContent = t.navHome;
    $('nav-label-input').textContent = t.navDescribe;
    $('nav-label-profile').textContent = t.navProfile || 'My info';
    $('nav-label-history').textContent = t.navHistory;
    $('nav-label-about').textContent = t.navAbout;

    // Language Selection cards
    document.querySelectorAll('.lang-card').forEach((card) => {
      const cardLang = card.getAttribute('data-lang');
      const isSelected = cardLang === lang;
      card.classList.toggle('selected', isSelected);
      card.setAttribute('aria-checked', String(isSelected));
      const badge = $(`lang-check-${cardLang}`);
      if (badge) badge.textContent = isSelected ? '✓ Selected' : 'Select';
    });
  }

  function navigate(screenName, { pushHistory = true } = {}) {
    if (!SCREENS[screenName]) return;

    if (screenName === 'home') {
      state.historyStack = [];
    } else if (pushHistory && state.currentScreen && state.currentScreen !== screenName) {
      const fromBottomTab = SCREENS[state.currentScreen]?.bottomNav && state.currentScreen !== 'home';
      const toBottomTab = SCREENS[screenName]?.bottomNav && screenName !== 'home';
      if (fromBottomTab && toBottomTab) {
        // Switching between sibling bottom-nav tabs returns cleanly to Home on Back
        state.historyStack = ['home'];
      } else if (state.currentScreen !== 'splash' && state.currentScreen !== 'processing') {
        if (state.historyStack[state.historyStack.length - 1] !== state.currentScreen) {
          state.historyStack.push(state.currentScreen);
        }
      }
    }

    state.currentScreen = screenName;
    const meta = SCREENS[screenName];

    document.querySelectorAll('.screen').forEach((sec) => sec.classList.remove('active'));
    $(`screen-${screenName}`).classList.add('active');

    $('topbar').classList.toggle('hidden', !meta.topbar);
    $('topbar').classList.toggle('no-back', meta.back === false);
    $('topbar-title').textContent = meta.title;
    $('bottom-nav').classList.toggle('hidden', !meta.bottomNav);
    $('main-content').classList.toggle('no-bottom-nav', !meta.bottomNav);
    $('main-content').classList.toggle('is-splash', screenName === 'splash');

    document.querySelectorAll('#bottom-nav .tab').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-screen') === screenName);
    });

    if (screenName === 'home') {
      renderHomeStats();
      if (!state.healthWarmed) {
        state.healthWarmed = true;
        window.VOICECARE_API?.checkHealth?.().catch(() => {});
      }
      maybeAutoSync();
    }
    if (screenName === 'profile') {
      renderProfileForm();
      maybeAutoSync();
    }
    if (screenName === 'history') {
      renderHistory();
      maybeAutoSync();
    }
    if (screenName === 'about') {
      updateSyncStatusUi();
    }

    // Never keep the microphone open after leaving the input screen.
    if (screenName !== 'input') window.VOICECARE_VOICE?.abort?.();

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderHomeStats() {
    const history = window.VOICECARE_STORAGE.getHistory();
    const profile = window.VOICECARE_STORAGE.getProfile();
    const hasProfile = Boolean(profile.name || profile.age || profile.bloodGroup);
    $('home-profile-summary').textContent = hasProfile
      ? quickInfoLine(profile)
      : 'Add name, age, blood group';
    $('home-history-count').textContent = `${history.length} saved visit${history.length === 1 ? '' : 's'}`;
  }

  /** One-line patient identity used on the home tile, summary and PDF. */
  function quickInfoLine(profile = {}) {
    const parts = [];
    if (profile.name) parts.push(profile.name);
    if (profile.age) parts.push(`${profile.age} yrs`);
    if (profile.gender) parts.push(profile.gender);
    if (profile.bloodGroup) parts.push(`Blood group ${profile.bloodGroup}`);
    if (profile.allergies) parts.push(`Allergies: ${profile.allergies}`);
    return parts.join(' · ');
  }

  function renderProfileForm() {
    const profile = window.VOICECARE_STORAGE.getProfile();
    $('profile-name').value = profile.name || '';
    $('profile-age').value = profile.age || '';
    $('profile-gender').value = profile.gender || '';
    $('profile-blood').value = profile.bloodGroup || '';
    $('profile-allergies').value = profile.allergies || '';
    $('profile-emergency').value = profile.emergencyContact || '';
  }

  function updateInputMeta() {
    const text = $('patient-input-box').value || '';
    $('input-char-count').textContent = `${text.length} / 5000 characters`;
    window.VOICECARE_STORAGE.setDraftText(text);
  }

  function buildSummarySectionHtml(s) {
    const rows = [
      { title: 'Main health concern', icon: 'i-target', type: 'text', value: s.mainHealthConcern },
      { title: 'Symptoms', icon: 'i-file', type: 'list', value: s.symptoms },
      { title: 'Duration', icon: 'i-calendar', type: 'text', value: s.duration },
      { title: 'Severity', icon: 'i-alert', type: 'text', value: s.severity },
      { title: 'Relevant medical history', icon: 'i-history', type: 'text', value: s.relevantMedicalHistory },
      { title: 'Current medications', icon: 'i-pill', type: 'text', value: s.currentMedications },
      { title: 'Additional observations', icon: 'i-eye', type: 'text', value: s.additionalObservations },
      { title: 'Questions to ask the doctor', icon: 'i-help', type: 'list', value: s.questionsToAskDoctor, isQuestions: true }
    ];

    return rows
      .map((row) => {
        let bodyHtml = '';
        if (row.type === 'list') {
          const items = Array.isArray(row.value) ? row.value.filter(Boolean) : [];
          bodyHtml = items.length
            ? `<ul class="record-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
            : `<p class="record-text">Not mentioned by patient</p>`;
        } else {
          bodyHtml = `<p class="record-text">${escapeHtml(row.value || 'Not mentioned by patient')}</p>`;
        }

        return `
          <div class="record-card${row.isQuestions ? ' is-questions' : ''}">
            <div class="record-head">
              <span class="record-icon"><svg class="icon icon-sm" aria-hidden="true"><use href="#${row.icon}"></use></svg></span>
              <span class="record-title">${escapeHtml(row.title)}</span>
            </div>
            ${bodyHtml}
          </div>
        `;
      })
      .join('');
  }

  function renderSummaryScreen() {
    const entry = state.currentEntry;
    if (!entry) return;

    renderUrgencyBanner(entry);

    $('summary-disclaimer-text').textContent =
      entry.metadata?.disclaimer ||
      'For doctor communication only — not a medical diagnosis or prescription.';

    const languageLabel = entry.languageLabel || 'English';
    $('summary-lang-badge').textContent = languageLabel;
    $('summary-native-label').textContent = `Your words · ${languageLabel}`;

    const meta = entry.metadata || {};
    $('summary-source-badge').textContent =
      meta.source === 'gemini'
        ? `Organised with Gemini AI${meta.model ? ` · ${meta.model}` : ''}`
        : `Basic local extractor used — the AI model was unavailable. Tap Regenerate to try again.`;

    $('summary-sections-container').innerHTML = buildSummarySectionHtml(entry.summary || {});
    $('summary-english-container').innerHTML = buildSummarySectionHtml(
      entry.englishSummary || entry.summary || {}
    );

    renderQuickInfoStrip(entry);
    renderOriginalWords(entry);
    setSummaryView('ai');
  }

  /**
   * Shows only the red flags the backend verified against the patient's own
   * words. Nothing here is a diagnosis or a severity judgement.
   */
  function renderUrgencyBanner(entry) {
    const banner = $('summary-emergency-banner');
    const meta = entry.metadata?.emergencyWarning || {};
    const flags = (Array.isArray(entry.urgentFlags) ? entry.urgentFlags : [])
      .concat(Array.isArray(meta.phrases) ? meta.phrases : [])
      .map((flag) => String(flag || '').trim())
      .filter(Boolean)
      .filter((flag, index, list) => list.findIndex((f) => f.toLowerCase() === flag.toLowerCase()) === index)
      .slice(0, 6);

    if (!flags.length && !meta.detected) {
      banner.style.display = 'none';
      return;
    }

    banner.style.display = 'block';
    $('summary-urgent-flags').innerHTML = flags
      .map((flag) => `<li>${escapeHtml(flag)}</li>`)
      .join('');
    $('summary-emergency-text').textContent =
      'These are your own words, repeated so your doctor sees them first. VoiceCare does not decide how serious they are.';
  }

  function renderQuickInfoStrip(entry) {
    const strip = $('summary-quickinfo-strip');
    const profile = entry.quickInfo || window.VOICECARE_STORAGE.getProfile();
    const line = quickInfoLine(profile);
    if (!line) {
      strip.classList.add('hidden');
      strip.innerHTML = '';
      return;
    }
    strip.classList.remove('hidden');
    strip.innerHTML = `<svg class="icon icon-sm" aria-hidden="true"><use href="#i-user"></use></svg><span>${escapeHtml(line)}</span>`;
  }

  function renderOriginalWords(entry) {
    $('summary-original-text').textContent = entry.patientText || 'No description was saved for this visit.';

    const answers = (Array.isArray(entry.followUpAnswers) ? entry.followUpAnswers : []).filter(
      (item) => item && String(item.answer || '').trim()
    );
    const panel = $('summary-answers-panel');
    if (answers.length) {
      panel.classList.remove('hidden');
      $('summary-answers-list').innerHTML = answers
        .map(
          (item) =>
            `<li><strong>${escapeHtml(item.question || 'Question')}</strong><br />${escapeHtml(item.answer)}</li>`
        )
        .join('');
    } else {
      panel.classList.add('hidden');
    }
  }

  function setSummaryView(view) {
    const isOriginal = view === 'original';
    $('summary-ai-pane').classList.toggle('hidden', isOriginal);
    $('summary-original-pane').classList.toggle('hidden', !isOriginal);
    document.querySelectorAll('[data-summary-view]').forEach((btn) => {
      const active = btn.getAttribute('data-summary-view') === view;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    });
  }

  function populateEditForm() {
    const entry = state.currentEntry;
    if (!entry) return;
    const s = entry.summary;

    $('edit-main-concern').value = s.mainHealthConcern || '';
    $('edit-symptoms').value = (s.symptoms || []).join('\n');
    $('edit-duration').value = s.duration || '';
    $('edit-severity').value = s.severity || '';
    $('edit-history').value = s.relevantMedicalHistory || '';
    $('edit-meds').value = s.currentMedications || '';
    $('edit-observations').value = s.additionalObservations || '';
    $('edit-questions').value = (s.questionsToAskDoctor || []).join('\n');
    $('edit-extra-notes').value = '';
    $('edit-confirm-checkbox').checked = Boolean(entry.confirmed);
  }

  function renderPdfPreview() {
    const entry = state.currentEntry;
    if (!entry) return;

    $('pdf-unconfirmed-banner').style.display = entry.confirmed ? 'none' : 'block';

    const dateStr = new Date(entry.updatedAt || entry.createdAt).toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
    const infoLine = window.VOICECARE_PDF?.patientLine?.(entry) || '';
    $('pdf-meta-line').textContent = `${infoLine ? `${infoLine} • ` : ''}Prepared: ${dateStr} • Language: ${entry.languageLabel || 'English'}`;

    const flags = (Array.isArray(entry.urgentFlags) ? entry.urgentFlags : []).filter(Boolean);
    const flagHtml = flags.length
      ? `<section class="alert alert-danger" style="display:block; margin-bottom: 12px;">
           <p class="alert-title">Urgent words said by the patient</p>
           <ul class="urgent-flag-list">${flags.map((flag) => `<li>${escapeHtml(flag)}</li>`).join('')}</ul>
           <p class="urgent-call-line">If this is an emergency, call 108.</p>
         </section>`
      : '';

    const original = entry.patientText
      ? `<section class="panel">
           <p class="section-label" style="margin-top: 0;">Patient's exact words</p>
           <p class="original-text">${escapeHtml(entry.patientText)}</p>
         </section>`
      : '';

    $('pdf-preview-body').innerHTML = `
      ${flagHtml}
      <p class="summary-lang-label">Patient's language · ${escapeHtml(entry.languageLabel || 'English')}</p>
      ${buildSummarySectionHtml(entry.summary || {})}
      <p class="summary-lang-label">English version</p>
      ${buildSummarySectionHtml(entry.englishSummary || entry.summary || {})}
      ${original}
    `;
  }

  function abortActiveSummaryRequest() {
    state.activeRequestId += 1;
    if (state.activeSummaryAbortController) {
      state.activeSummaryAbortController.abort();
      state.activeSummaryAbortController = null;
    }
  }

  async function runAiSummarization({ patientText, extraNotes = '', endpoint = 'summarize' }) {
    abortActiveSummaryRequest();
    const requestId = state.activeRequestId;
    const controller = new AbortController();
    state.activeSummaryAbortController = controller;
    navigate('processing');

    const step1 = $('proc-step-1');
    const step2 = $('proc-step-2');
    const step3 = $('proc-step-3');
    step1.classList.add('is-active');
    step2.classList.remove('is-active');
    step3.classList.remove('is-active');

    const t1 = setTimeout(() => step2.classList.add('is-active'), 450);
    const t2 = setTimeout(() => step3.classList.add('is-active'), 950);

    try {
      const result = await window.VOICECARE_API.generateSummary({
        patientText,
        language: state.language,
        extraNotes,
        followUpAnswers: state.pendingFollowUpAnswers,
        endpoint,
        signal: controller.signal
      });

      clearTimeout(t1);
      clearTimeout(t2);
      if (requestId !== state.activeRequestId) return;

      const langObj = window.VOICECARE_I18N[state.language] || window.VOICECARE_I18N.en;
      const now = new Date().toISOString();

      const entry = {
        id: state.currentEntry?.id || `vc_${Date.now()}`,
        patientName: state.user?.name || '',
        patientText,
        language: state.language,
        languageLabel: langObj.nativeName,
        summary: result.summary,
        englishSummary: result.englishSummary,
        urgentFlags: Array.isArray(result.urgentFlags) ? result.urgentFlags : [],
        missingInfo: Array.isArray(result.missingInfo) ? result.missingInfo : [],
        followUpAnswers: state.pendingFollowUpAnswers,
        // Snapshot the quick-info card so an old summary keeps the details it
        // was created with, even if the patient edits the card later.
        quickInfo: window.VOICECARE_STORAGE.getProfile(),
        metadata: result.metadata,
        confirmed: false,
        synced: false,
        createdAt: state.currentEntry?.createdAt || now,
        updatedAt: now
      };

      state.currentEntry = entry;
      window.VOICECARE_STORAGE.saveHistoryEntry(entry);
      persistEntryToCloud(entry);

      renderSummaryScreen();
      navigate('summary');
    } catch (err) {
      clearTimeout(t1);
      clearTimeout(t2);
      if (requestId !== state.activeRequestId || err?.name === 'AbortError') return;
      showToast(err.message || 'Failed to generate summary.');
      navigate('input', { pushHistory: false });
    } finally {
      if (state.activeSummaryAbortController === controller) {
        state.activeSummaryAbortController = null;
      }
    }
  }

  function updateSyncStatusUi() {
    const titleEl = $('settings-sync-title');
    const statusEl = $('settings-sync-status');
    if (!statusEl) return;
    if (!state.user || state.user.mode !== 'supabase') {
      if (titleEl) titleEl.textContent = 'Cloud backup & sync';
      statusEl.textContent = 'Guest mode (stored on this phone only)';
      return;
    }
    if (titleEl) {
      titleEl.textContent = state.user.email ? `Cloud sync · ${state.user.email}` : 'Cloud backup & sync';
    }
    if (state.syncing) {
      statusEl.textContent = 'Syncing summaries…';
    } else if (state.syncStatusText) {
      statusEl.textContent = state.syncStatusText;
    } else {
      const hCount = window.VOICECARE_STORAGE.getHistory(state.user.uid).length;
      statusEl.textContent = `Tap to sync now (${hCount} saved summar${hCount === 1 ? "y" : "ies"})`;
    }
  }

  function isCloudOk(res) {
    return res === true || (res && typeof res === 'object' && res.ok === true);
  }

  function normalizeSummaryLoad(res) {
    if (Array.isArray(res)) return { ok: true, items: res };
    if (res && res.ok && Array.isArray(res.items)) return res;
    if (res && res.ok === false) return res;
    return { ok: false, error: 'Could not load cloud summaries.' };
  }

  function persistEntryToCloud(entry) {
    const user = state.user;
    if (!user || user.mode !== 'supabase') return;
    window.VOICECARE_SUPABASE?.syncSummaryToCloud?.(user, entry)
      ?.then((res) => {
        if (isCloudOk(res)) {
          window.VOICECARE_STORAGE.saveHistoryEntry({ ...entry, synced: true }, user.uid);
          state.syncStatusText = 'All summaries & reminders synced';
        } else if (res?.error) {
          state.syncStatusText = res.error;
        }
        updateSyncStatusUi();
      })
      ?.catch(() => {});
  }

  function maybeAutoSync() {
    if (!state.user || state.user.mode !== 'supabase') return;
    if (state.syncing || Date.now() - state.lastSyncAt < 8000) return;
    syncAccountData(state.user, { adoptGuest: true, silent: true }).catch(() => {});
  }

  async function syncAccountData(user, { adoptGuest = true, silent = false } = {}) {
    if (!user || user.mode !== 'supabase') return;
    if (state.syncing) return;
    state.syncing = true;
    updateSyncStatusUi();

    try {
      if (adoptGuest) {
        window.VOICECARE_STORAGE.adoptGuestDataForUser(user.uid);
      }

      // Immediately reflect any locally adopted summaries/reminders before network returns
      if (state.currentScreen === 'home') renderHomeStats();
      if (state.currentScreen === 'history') renderHistory();

      const rawSumRes = await window.VOICECARE_SUPABASE.loadCloudSummaries(user).catch((e) => ({
        ok: false,
        error: e.message
      }));

      const sumRes = normalizeSummaryLoad(rawSumRes);
      const syncErrors = [];

      if (sumRes.authExpired) {
        state.syncStatusText = 'Sign-in session expired. Please sign out and sign in again to sync.';
        if (!silent) showToast(state.syncStatusText);
        return;
      }

      if (sumRes.ok) {
        const cloudSummaries = sumRes.items;
        const localList = window.VOICECARE_STORAGE.getHistory(user.uid);
        const cloudMap = new Map(cloudSummaries.map((c) => [c.id, c]));
        const mergedMap = new Map();

        for (const c of cloudSummaries) {
          mergedMap.set(c.id, { ...c, synced: true });
        }

        const unsyncedToUpload = [];
        for (const l of localList) {
          if (!l || !l.id) continue;
          const c = cloudMap.get(l.id);
          if (c) {
            const lTime = String(l.updatedAt || l.createdAt || '');
            const cTime = String(c.updatedAt || c.createdAt || '');
            if (lTime > cTime && l.synced !== true) {
              mergedMap.set(l.id, l);
              unsyncedToUpload.push(l);
            }
          } else if (l.synced !== true) {
            mergedMap.set(l.id, l);
            unsyncedToUpload.push(l);
          }
        }

        const sortedSummaries = Array.from(mergedMap.values()).sort((a, b) =>
          String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))
        );
        window.VOICECARE_STORAGE.replaceHistory(sortedSummaries, user.uid);

        if (unsyncedToUpload.length > 0) {
          await Promise.all(
            unsyncedToUpload.map(async (entry) => {
              const res = await window.VOICECARE_SUPABASE.syncSummaryToCloud(user, entry);
              if (isCloudOk(res)) {
                window.VOICECARE_STORAGE.saveHistoryEntry({ ...entry, synced: true }, user.uid);
              } else if (res?.error) {
                syncErrors.push(res.error);
              }
            })
          );
        }
      } else if (sumRes.error) {
        syncErrors.push(sumRes.error);
      }

      state.lastSyncAt = Date.now();
      if (syncErrors.length > 0) {
        state.syncStatusText = `Sync issue: ${syncErrors[0]}`;
        if (!silent) showToast(state.syncStatusText);
      } else {
        const hLen = window.VOICECARE_STORAGE.getHistory(user.uid).length;
        state.syncStatusText = `Synced (${hLen} saved summar${hLen === 1 ? 'y' : 'ies'})`;
      }

      if (state.currentScreen === 'home') renderHomeStats();
      if (state.currentScreen === 'history') renderHistory();
    } finally {
      state.syncing = false;
      updateSyncStatusUi();
    }
  }

  function refreshDraftBoxForActiveUser() {
    const box = $('patient-input-box');
    if (!box) return;
    box.value = window.VOICECARE_STORAGE.getDraftText();
    updateInputMeta();
  }

  function renderHistory() {
    const query = ($('history-search').value || '').trim().toLowerCase();
    const list = window.VOICECARE_STORAGE.getHistory().filter((item) => {
      if (!query) return true;
      const hay = `${item.summary?.mainHealthConcern || ''} ${item.patientText || ''} ${(item.summary?.symptoms || []).join(' ')}`.toLowerCase();
      return hay.includes(query);
    });

    const container = $('history-list');
    if (!list.length) {
      const emptyMsg = query
        ? 'No saved summaries match your search.'
        : 'No saved summaries yet.';
      container.innerHTML = `<div class="empty-state">${emptyMsg}</div>`;
      return;
    }

    container.innerHTML = list
      .map((item) => {
        const dateStr = new Date(item.updatedAt || item.createdAt).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        });
        return `
          <div class="item">
            <div class="item-head">
              <span class="item-title">${escapeHtml(item.summary?.mainHealthConcern || 'Health summary')}</span>
              <span class="badge">${escapeHtml(item.languageLabel || 'English')}</span>
            </div>
            <p class="item-meta">
              ${escapeHtml(dateStr)} · ${escapeHtml((item.patientText || '').slice(0, 80))}${(item.patientText || '').length > 80 ? '…' : ''}
            </p>
            <div class="item-actions">
              <button class="btn btn-secondary btn-sm" data-hist-open="${escapeHtml(item.id)}" type="button">
                Open
              </button>
              <button class="btn btn-danger btn-sm" data-hist-del="${escapeHtml(item.id)}" type="button">
                Delete
              </button>
            </div>
          </div>
        `;
      })
      .join('');

    container.querySelectorAll('[data-hist-open]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-hist-open');
        const found = window.VOICECARE_STORAGE.getHistory().find((x) => x.id === id);
        if (!found) return;
        state.currentEntry = found;
        renderSummaryScreen();
        navigate('summary');
      });
    });

    container.querySelectorAll('[data-hist-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-hist-del');
        window.VOICECARE_STORAGE.deleteHistoryEntry(id);
        window.VOICECARE_SUPABASE?.deleteCloudSummary?.(state.user, id);
        if (state.currentEntry?.id === id) state.currentEntry = null;
        renderHistory();
        showToast('Saved summary deleted.');
      });
    });
  }

  /**
   * Renders one skippable card per follow-up question, each with its own answer
   * box (typed or dictated).
   * @param {string[]} questions
   */
  function renderFollowUpForm(questions) {
    const container = $('followup-list');
    container.innerHTML = questions
      .map(
        (question, index) => `
      <section class="followup-card" data-fu-card="${index}">
        <p class="followup-question"><span class="followup-number">${index + 1}</span>${escapeHtml(question)}</p>
        <textarea
          id="fu-answer-${index}"
          class="textarea"
          rows="2"
          maxlength="300"
          placeholder="Type your answer, or tap Speak answer"
        ></textarea>
        <div class="inline-pills" style="margin-top: 8px;">
          <button class="btn btn-secondary btn-sm" data-fu-mic="${index}" type="button">
            <svg class="icon icon-sm" aria-hidden="true"><use href="#i-mic"></use></svg>
            Speak answer
          </button>
          <button class="btn btn-quiet btn-sm" data-fu-skip="${index}" type="button">Skip</button>
        </div>
      </section>`
      )
      .join('');

    container.querySelectorAll('[data-fu-mic]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const index = btn.getAttribute('data-fu-mic');
        window.VOICECARE_VOICE?.setTarget?.(`fu-answer-${index}`);
        window.VOICECARE_VOICE?.toggle?.();
      });
    });

    container.querySelectorAll('[data-fu-skip]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const index = btn.getAttribute('data-fu-skip');
        const area = $(`fu-answer-${index}`);
        if (area) area.value = '';
        container.querySelector(`[data-fu-card="${index}"]`)?.classList.add('is-skipped');
      });
    });
  }

  /** Only answers the patient actually gave are sent; a skip contributes nothing. */
  function collectFollowUpAnswers() {
    const answers = [];
    state.followUpQuestions.forEach((question, index) => {
      const area = $(`fu-answer-${index}`);
      const answer = area ? String(area.value || '').trim() : '';
      if (answer) answers.push({ question, answer: answer.slice(0, 300) });
    });
    return answers;
  }

  /**
   * Asks the backend what is missing, then either shows the questions or goes
   * straight to the summary when the description is already complete.
   * @param {string} patientText
   */
  async function startFollowUpStep(patientText) {
    state.pendingPatientText = patientText;
    state.pendingFollowUpAnswers = [];
    state.followUpQuestions = [];

    abortActiveSummaryRequest();
    navigate('processing');

    try {
      const data = await window.VOICECARE_API.getFollowUpQuestions({
        patientText,
        language: state.language
      });

      const questions = (Array.isArray(data?.followUpQuestions) ? data.followUpQuestions : [])
        .filter((q) => typeof q === 'string' && q.trim())
        .slice(0, 3);

      if (!questions.length) {
        runAiSummarization({ patientText, endpoint: 'summarize' });
        return;
      }

      state.followUpQuestions = questions;
      renderFollowUpForm(questions);
      $('followup-status').textContent = '';
      navigate('followup');
    } catch {
      // The question step must never block a patient from getting a summary.
      runAiSummarization({ patientText, endpoint: 'summarize' });
    }
  }

  function wireEvents() {
    // 1. Splash (Get started shows only on first install)
    $('btn-splash-start').addEventListener('click', () => {
      window.VOICECARE_STORAGE.setOnboarded(true);
      $('btn-splash-start')?.classList.add('hidden');
      if (state.user) {
        navigate('home', { pushHistory: false });
      } else {
        navigate('auth', { pushHistory: false });
      }
    });

    // 2. Auth / Guest Demo
    $('btn-guest-demo').addEventListener('click', () => {
      const enteredName = sanitizeInput($('guest-name-input').value, 80);
      state.user = {
        uid: 'guest-demo',
        name: enteredName || 'Guest Patient',
        mode: 'guest'
      };
      window.VOICECARE_STORAGE.setUser(state.user);
      refreshDraftBoxForActiveUser();
      applyLanguage();
      navigate('home', { pushHistory: false });
      showToast(`Welcome, ${state.user.name}!`);
    });

    // Guest mode / Sign in (side-by-side) + Sign up / Forgot / Reset views
    const authTabs = document.querySelectorAll('[data-auth-tab]');
    const guestPanel = $('auth-panel-guest');
    const loginPanel = $('auth-panel-login');
    const signupPanel = $('auth-panel-signup');
    const forgotPanel = $('auth-panel-forgot');
    const resetPanel = $('auth-panel-reset');

    function setAuthFeedback(boxId, message, isSuccess = false) {
      const box = $(boxId);
      if (!box) return;
      if (!message) {
        box.textContent = '';
        box.classList.add('hidden');
        box.classList.remove('is-success');
        return;
      }
      box.textContent = message;
      box.classList.remove('hidden');
      box.classList.toggle('is-success', isSuccess);
    }

    function switchAuthTab(target) {
      const activeTopTab = target === 'guest' ? 'guest' : 'login';
      authTabs.forEach((tab) => {
        const isActive = tab.getAttribute('data-auth-tab') === activeTopTab;
        tab.classList.toggle('is-active', isActive);
        tab.setAttribute('aria-selected', String(isActive));
      });

      setAuthFeedback('login-error-box', '');
      setAuthFeedback('signup-error-box', '');
      setAuthFeedback('forgot-error-box', '');
      setAuthFeedback('reset-error-box', '');

      guestPanel.classList.toggle('hidden', target !== 'guest');
      loginPanel.classList.toggle('hidden', target !== 'login');
      signupPanel.classList.toggle('hidden', target !== 'signup');
      forgotPanel?.classList.toggle('hidden', target !== 'forgot');
      resetPanel?.classList.toggle('hidden', target !== 'reset');

      if (target === 'login') {
        setTimeout(() => $('login-email')?.focus(), 120);
      } else if (target === 'signup') {
        setTimeout(() => $('signup-email')?.focus(), 120);
      } else if (target === 'forgot') {
        setTimeout(() => $('forgot-email')?.focus(), 120);
      } else if (target === 'reset') {
        setTimeout(() => $('reset-password')?.focus(), 120);
      }
    }

    authTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        switchAuthTab(tab.getAttribute('data-auth-tab'));
      });
    });

    $('link-to-signup')?.addEventListener('click', (e) => {
      e.preventDefault();
      switchAuthTab('signup');
    });

    $('link-to-login')?.addEventListener('click', (e) => {
      e.preventDefault();
      switchAuthTab('login');
    });

    $('link-forgot-to-login')?.addEventListener('click', (e) => {
      e.preventDefault();
      switchAuthTab('login');
    });

    $('link-reset-to-login')?.addEventListener('click', (e) => {
      e.preventDefault();
      switchAuthTab('login');
    });

    $('btn-forgot-password')?.addEventListener('click', () => {
      const typedEmail = sanitizeInput($('login-email')?.value || '', 120);
      switchAuthTab('forgot');
      if (typedEmail && $('forgot-email')) {
        $('forgot-email').value = typedEmail;
      }
    });

    $('forgot-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      setAuthFeedback('forgot-error-box', '');
      const email = sanitizeInput($('forgot-email').value, 120);
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setAuthFeedback('forgot-error-box', 'Please enter a valid email address.');
        $('forgot-email')?.focus();
        return;
      }
      const btn = $('btn-send-reset');
      if (btn) btn.disabled = true;
      try {
        await window.VOICECARE_SUPABASE.resetPassword(email);
        setAuthFeedback(
          'forgot-error-box',
          `Reset link sent to ${email}. Open the link in your email to choose a new password.`,
          true
        );
        showToast('Password reset email sent!');
      } catch (err) {
        setAuthFeedback('forgot-error-box', err.message || 'Could not send reset email.');
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    $('reset-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      setAuthFeedback('reset-error-box', '');
      const newPassword = $('reset-password').value;
      const confirmPassword = $('reset-password-confirm').value;

      if (!newPassword || newPassword.length < 6) {
        setAuthFeedback('reset-error-box', 'Password must be at least 6 characters.');
        return;
      }
      if (newPassword !== confirmPassword) {
        setAuthFeedback('reset-error-box', 'Passwords do not match.');
        return;
      }

      const btn = $('btn-update-password');
      if (btn) btn.disabled = true;
      try {
        const user = await window.VOICECARE_SUPABASE.updatePassword(newPassword);
        if (user) {
          state.user = user;
          window.VOICECARE_STORAGE.setUser(user, { rememberDays: 30 });
          refreshDraftBoxForActiveUser();
          applyLanguage();
          await syncAccountData(user, { adoptGuest: true });
          navigate('home', { pushHistory: false });
          showToast('Password updated! You are signed in.');
        } else {
          switchAuthTab('login');
          setAuthFeedback('login-error-box', 'Password updated! Please sign in.', true);
        }
      } catch (err) {
        setAuthFeedback('reset-error-box', err.message || 'Could not update password.');
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    window.VOICECARE_SUPABASE?.onPasswordRecovery?.(() => {
      state.isPasswordRecovery = true;
      navigate('auth', { pushHistory: false });
      switchAuthTab('reset');
    });

    $('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      setAuthFeedback('login-error-box', '');
      const email = sanitizeInput($('login-email').value, 120);
      const password = $('login-password').value;
      const rememberDays = $('login-remember')?.checked ? 30 : 1;

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setAuthFeedback('login-error-box', 'Please enter a valid email address.');
        return;
      }
      if (!password) {
        setAuthFeedback('login-error-box', 'Please enter your password.');
        return;
      }
      const submitBtn = $('login-form').querySelector('[type="submit"]');
      const originalText = submitBtn?.textContent || 'Sign in';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Signing in…';
      }
      try {
        const user = await window.VOICECARE_SUPABASE.signInWithEmail(email, password);
        state.user = user;
        window.VOICECARE_STORAGE.setUser(user, { rememberDays });
        $('login-password').value = '';
        refreshDraftBoxForActiveUser();
        applyLanguage();

        await syncAccountData(user, { adoptGuest: true });

        navigate('home', { pushHistory: false });
        showToast(`Welcome back, ${user.name}!`);
      } catch (err) {
        const msg = err.message || 'Wrong email or password. Please try again.';
        setAuthFeedback('login-error-box', msg);
        showToast(msg);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
        }
      }
    });

    $('signup-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      setAuthFeedback('signup-error-box', '');
      const name = sanitizeInput($('signup-name').value, 80);
      const email = sanitizeInput($('signup-email').value, 120);
      const password = $('signup-password').value;

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setAuthFeedback('signup-error-box', 'Please enter a valid email address.');
        return;
      }
      if (!password || password.length < 6) {
        setAuthFeedback('signup-error-box', 'Password must be at least 6 characters.');
        return;
      }
      const submitBtn = $('signup-form').querySelector('[type="submit"]');
      const originalText = submitBtn?.textContent || 'Sign up';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating account…';
      }
      try {
        const user = await window.VOICECARE_SUPABASE.signUpWithEmail(email, password, name);
        $('signup-password').value = '';
        if (user.needsConfirmation) {
          switchAuthTab('login');
          if ($('login-email')) $('login-email').value = email;
          setAuthFeedback(
            'login-error-box',
            'Account created! Please check your email to confirm, then sign in.',
            true
          );
          showToast('Confirmation email sent!');
          return;
        }
        state.user = user;
        window.VOICECARE_STORAGE.setUser(user, { rememberDays: 30 });
        refreshDraftBoxForActiveUser();
        applyLanguage();

        await syncAccountData(user, { adoptGuest: true });

        navigate('home', { pushHistory: false });
        showToast(`Account created! Welcome, ${user.name}!`);
      } catch (err) {
        const msg = err.message || 'Could not create account.';
        setAuthFeedback('signup-error-box', msg);
        showToast(msg);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
        }
      }
    });

    // Google sign-in / sign-up (Supabase OAuth).
    ['btn-google-signin', 'btn-google-signup'].forEach((id) => {
      const googleButton = $(id);
      if (!googleButton) return;
      googleButton.addEventListener('click', async () => {
        googleButton.disabled = true;
        const originalLabel = googleButton.innerHTML;
        googleButton.textContent = 'Opening Google…';
        try {
          const user = await window.VOICECARE_SUPABASE.signInWithGoogle();
          if (!user) return; // page is navigating to Google

          state.user = user;
          window.VOICECARE_STORAGE.setUser(user);
          refreshDraftBoxForActiveUser();
          applyLanguage();

          await syncAccountData(user, { adoptGuest: true });

          navigate('home', { pushHistory: false });
          showToast(`Signed in as ${user.name}.`);
        } catch (err) {
          showToast(err.message || 'Google sign-in failed. Please try again.');
        } finally {
          googleButton.disabled = false;
          googleButton.innerHTML = originalLabel;
        }
      });
    });

    // Topbar Back & Language Pill
    function goBack() {
      // On root screens (Home, Auth, Splash), do not navigate elsewhere — exit app
      if (
        state.currentScreen === 'home' ||
        state.currentScreen === 'auth' ||
        state.currentScreen === 'splash'
      ) {
        return false;
      }

      // If on processing screen, cancel and return to input
      if (state.currentScreen === 'processing') {
        abortActiveSummaryRequest();
        navigate('input', { pushHistory: false });
        return true;
      }

      const prev = state.historyStack.pop();
      if (prev && prev !== state.currentScreen) {
        navigate(prev, { pushHistory: false });
        return true;
      }

      // If on any sub-screen without history, return to home
      navigate('home', { pushHistory: false });
      return true;
    }

    $('btn-back')?.addEventListener('click', goBack);

    // Native Android Hardware / Gesture Back Button handling
    function handleHardwareBack() {
      const handled = goBack();
      if (handled) return;

      // Exit app immediately when pressing back on Home / root screen
      if (window.Capacitor?.Plugins?.App) {
        window.Capacitor.Plugins.App.exitApp();
      }
    }

    if (window.Capacitor?.Plugins?.App) {
      window.Capacitor.Plugins.App.addListener('backButton', () => {
        handleHardwareBack();
      });
    }

    // Also support standard browser popstate
    window.addEventListener('popstate', (e) => {
      e.preventDefault();
      goBack();
    });

    $('btn-lang-pill').addEventListener('click', () => navigate('language'));

    // Bottom Navigation
    document.querySelectorAll('#bottom-nav .tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        navigate(btn.getAttribute('data-screen'));
      });
    });

    // 3. Home Dashboard tiles
    $('btn-home-describe').addEventListener('click', () => {
      state.currentEntry = null;
      navigate('input');
    });
    $('tile-language').addEventListener('click', () => navigate('language'));
    $('tile-profile').addEventListener('click', () => navigate('profile'));
    $('tile-history').addEventListener('click', () => navigate('history'));
    $('tile-about').addEventListener('click', () => navigate('about'));

    // 4. Language Selection
    document.querySelectorAll('.lang-card').forEach((card) => {
      card.addEventListener('click', () => {
        state.language = card.getAttribute('data-lang');
        window.VOICECARE_STORAGE.setLanguage(state.language);
        applyLanguage();
      });
    });

    $('btn-lang-continue').addEventListener('click', () => navigate('input'));

    // 5. Patient Health Input (typed, or spoken with the in-app recorder)
    const inputBox = $('patient-input-box');
    inputBox.value = window.VOICECARE_STORAGE.getDraftText();
    updateInputMeta();

    inputBox.addEventListener('input', updateInputMeta);
    inputBox.addEventListener('compositionend', updateInputMeta);

    // The on-screen keyboard opens over the page on phones. Keep the box (and the
    // Generate button) visible after it appears.
    inputBox.addEventListener('focus', () => {
      setTimeout(() => {
        inputBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 320);
    });

    $('btn-clear-input').addEventListener('click', () => {
      inputBox.value = '';
      updateInputMeta();
      inputBox.focus();
    });

    $('btn-fill-sample').addEventListener('click', () => {
      const t = window.VOICECARE_I18N[state.language] || window.VOICECARE_I18N.en;
      inputBox.value = t.sampleText;
      updateInputMeta();
      showToast('Sample description loaded. You can edit it or tap Generate.');
    });

    $('btn-generate-summary').addEventListener('click', () => {
      if (window.VOICECARE_VOICE?.isRecording?.()) {
        showToast('Tap the microphone to finish your recording first.');
        return;
      }
      if (window.VOICECARE_VOICE?.isBusy?.()) {
        showToast('Please wait while your recording is written down.');
        return;
      }
      const text = inputBox.value.trim();
      if (text.length < 3) {
        showToast('Please tap the mic to speak, or type your health concern first.');
        inputBox.focus();
        return;
      }
      if (text.length > 5000) {
        showToast('Please keep your description under 5,000 characters.');
        inputBox.focus();
        return;
      }
      state.currentEntry = null;
      startFollowUpStep(text);
    });

    // 5b. Follow-up questions — answers are optional, skipping is always allowed.
    function submitFollowUp(withAnswers) {
      if (window.VOICECARE_VOICE?.isRecording?.()) window.VOICECARE_VOICE.stop();
      if (window.VOICECARE_VOICE?.isBusy?.()) {
        showToast('Please wait while your answer is written down.');
        return;
      }
      window.VOICECARE_VOICE?.setTarget?.('patient-input-box');
      state.pendingFollowUpAnswers = withAnswers ? collectFollowUpAnswers() : [];
      runAiSummarization({
        patientText: state.pendingPatientText || inputBox.value.trim(),
        endpoint: 'summarize'
      });
    }

    $('btn-followup-continue')?.addEventListener('click', () => submitFollowUp(true));
    $('btn-followup-skip')?.addEventListener('click', () => submitFollowUp(false));

    // 5c. Quick-info card — saved once, attached to every summary and PDF.
    $('profile-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const profile = window.VOICECARE_STORAGE.saveProfile({
        name: $('profile-name').value,
        age: $('profile-age').value,
        gender: $('profile-gender').value,
        bloodGroup: $('profile-blood').value,
        allergies: $('profile-allergies').value,
        emergencyContact: $('profile-emergency').value
      });
      renderHomeStats();
      if (state.currentEntry && state.currentScreen === 'summary') renderSummaryScreen();
      showToast(
        profile.name
          ? `Saved. ${profile.name}'s details will appear on every summary.`
          : 'Saved. These details will appear on every summary.'
      );
    });

    // 5d. Original words vs AI summary
    document.querySelectorAll('[data-summary-view]').forEach((btn) => {
      btn.addEventListener('click', () => setSummaryView(btn.getAttribute('data-summary-view')));
    });

    // 6. AI Processing cancel
    $('btn-cancel-processing').addEventListener('click', () => {
      abortActiveSummaryRequest();
      navigate('input', { pushHistory: false });
    });

    // 7. Summary Screen actions
    $('btn-edit-summary').addEventListener('click', () => {
      populateEditForm();
      navigate('edit');
    });

    $('btn-regenerate-summary').addEventListener('click', () => {
      if (!state.currentEntry?.patientText) {
        showToast('Original description is unavailable for regeneration.');
        return;
      }
      state.pendingFollowUpAnswers = state.currentEntry.followUpAnswers || [];
      runAiSummarization({
        patientText: state.currentEntry.patientText,
        endpoint: 'regenerate'
      });
    });

    $('btn-go-pdf').addEventListener('click', () => {
      renderPdfPreview();
      navigate('pdf');
      window.VOICECARE_SHARE?.showForEntry?.(state.currentEntry);
    });

    // 7b. QR share (doctor opens it in a browser, no login)
    $('btn-copy-share-link')?.addEventListener('click', () => window.VOICECARE_SHARE?.copyLink?.());
    $('btn-share-link')?.addEventListener('click', async () => {
      if (!state.currentEntry) return;
      try {
        await window.VOICECARE_SHARE.nativeShare(state.currentEntry);
      } catch (err) {
        showToast(err.message || 'Could not share the link.');
      }
    });

    // 8. Edit Summary Screen
    $('btn-edit-regenerate').addEventListener('click', () => {
      if (!state.currentEntry?.patientText) {
        showToast('Original description is unavailable for regeneration.');
        return;
      }
      const extraNotes = $('edit-extra-notes').value.trim();
      state.pendingFollowUpAnswers = state.currentEntry.followUpAnswers || [];
      runAiSummarization({
        patientText: state.currentEntry.patientText,
        extraNotes,
        endpoint: 'regenerate'
      });
    });

    $('edit-summary-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!state.currentEntry) return;

      const parseLines = (raw) =>
        raw
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);

      const updatedSummary = {
        mainHealthConcern: $('edit-main-concern').value.trim() || 'Not mentioned by patient',
        symptoms: parseLines($('edit-symptoms').value),
        duration: $('edit-duration').value.trim() || 'Not mentioned by patient',
        severity: $('edit-severity').value.trim() || 'Not mentioned by patient',
        relevantMedicalHistory: $('edit-history').value.trim() || 'Not mentioned by patient',
        currentMedications: $('edit-meds').value.trim() || 'Not mentioned by patient',
        additionalObservations: $('edit-observations').value.trim() || 'Not mentioned by patient',
        questionsToAskDoctor: parseLines($('edit-questions').value)
      };

      state.currentEntry = {
        ...state.currentEntry,
        summary: updatedSummary,
        confirmed: $('edit-confirm-checkbox').checked,
        synced: false,
        updatedAt: new Date().toISOString()
      };

      window.VOICECARE_STORAGE.saveHistoryEntry(state.currentEntry);
      persistEntryToCloud(state.currentEntry);

      renderSummaryScreen();
      renderPdfPreview();
      navigate('pdf');
      showToast('Summary updated!');
    });

    // 9. PDF Preview & Share
    $('btn-quick-confirm').addEventListener('click', () => {
      if (!state.currentEntry) return;
      state.currentEntry.confirmed = true;
      state.currentEntry.synced = false;
      state.currentEntry.updatedAt = new Date().toISOString();
      window.VOICECARE_STORAGE.saveHistoryEntry(state.currentEntry);
      persistEntryToCloud(state.currentEntry);
      renderPdfPreview();
      showToast('Summary confirmed for sharing.');
    });

    $('btn-download-pdf').addEventListener('click', async () => {
      if (!state.currentEntry) return;
      try {
        const res = await window.VOICECARE_PDF.downloadPdf(state.currentEntry);
        showToast(
          res.method === 'print'
            ? 'Opened print dialog to save as PDF.'
            : `Saved ${res.fileName}`
        );
      } catch (err) {
        showToast(`Could not download PDF: ${err.message}`);
      }
    });

    $('btn-share-doctor').addEventListener('click', async () => {
      if (!state.currentEntry) return;
      if (!state.currentEntry.confirmed) {
        showToast('Please tap "I Confirm This Summary" before sharing with your doctor.');
        return;
      }
      try {
        const res = await window.VOICECARE_PDF.shareWithDoctor(state.currentEntry);
        if (res.method === 'clipboard-fallback') {
          showToast('Summary copied to clipboard — ready to paste in WhatsApp or SMS!');
        } else {
          showToast('Share dialog opened.');
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          showToast('Could not open share sheet. Try Copy Text Summary.');
        }
      }
    });

    $('btn-copy-summary').addEventListener('click', async () => {
      if (!state.currentEntry) return;
      const text = window.VOICECARE_PDF.formatPlainTextSummary(state.currentEntry);
      try {
        await window.VOICECARE_PDF.copyTextSafe(text);
        showToast('Doctor-friendly summary copied!');
      } catch {
        showToast('Clipboard permission unavailable in this browser.');
      }
    });

    // 11. History search
    $('history-search').addEventListener('input', renderHistory);

    // 12. Accessibility & Settings
    const saveAcc = () => {
      state.accessibility = {
        textSize: $('acc-text-size').value,
        highContrast: $('acc-high-contrast').checked,
        reducedMotion: $('acc-reduced-motion').checked
      };
      window.VOICECARE_STORAGE.setAccessibility(state.accessibility);
      applyAccessibility();
    };

    $('acc-text-size').addEventListener('change', saveAcc);
    $('acc-high-contrast').addEventListener('change', saveAcc);
    $('acc-reduced-motion').addEventListener('change', saveAcc);

    document.querySelectorAll('[data-text-size]').forEach((btn) => {
      btn.addEventListener('click', () => {
        $('acc-text-size').value = btn.getAttribute('data-text-size');
        saveAcc();
      });
    });

    $('settings-sync-row')?.addEventListener('click', async () => {
      if (!state.user || state.user.mode !== 'supabase') {
        showToast('Sign in on the login screen to sync your data across devices.');
        return;
      }
      await syncAccountData(state.user, { adoptGuest: true, silent: false });
      if (!state.syncStatusText.startsWith('Sync issue') && !state.syncStatusText.includes('expired')) {
        showToast(state.syncStatusText || 'Cloud sync complete!');
      }
    });

    $('settings-lang-row')?.addEventListener('click', () => navigate('language'));
    $('settings-privacy-row')?.addEventListener('click', () => {
      $('privacy-details-card')?.classList.toggle('hidden');
    });
    $('home-avatar-btn')?.addEventListener('click', () => navigate('about'));

    document.querySelectorAll('[data-toggle-pw]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = $(btn.getAttribute('data-toggle-pw'));
        if (!input) return;
        const isPw = input.type === 'password';
        input.type = isPw ? 'text' : 'password';
        btn.setAttribute('aria-label', isPw ? 'Hide password' : 'Show password');
      });
    });

    $('btn-logout').addEventListener('click', async () => {
      abortActiveSummaryRequest();
      await window.VOICECARE_SUPABASE?.signOut?.();
      window.VOICECARE_STORAGE.clearUser();
      state.user = null;
      state.currentEntry = null;
      state.historyStack = [];
      state.syncStatusText = '';
      state.lastSyncAt = 0;
      refreshDraftBoxForActiveUser();
      updateSyncStatusUi();
      ['login-password', 'signup-password', 'reset-password', 'reset-password-confirm'].forEach((id) => {
        const el = $(id);
        if (el) el.value = '';
      });
      switchAuthTab('guest');
      navigate('auth', { pushHistory: false });
      showToast('Signed out.');
    });
  }

  function init() {
    applyAccessibility();
    applyLanguage();
    wireEvents();

    const isFirstInstall = !window.VOICECARE_STORAGE.hasOnboarded() && !state.user;
    const splashStartBtn = $('btn-splash-start');
    if (splashStartBtn) {
      splashStartBtn.classList.toggle('hidden', !isFirstInstall);
    }

    if (!window.VOICECARE_SUPABASE.isConfigured() && $('firebase-status-note')) {
      $('firebase-status-note').textContent =
        'Sign in to save and sync your doctor consultation summaries across devices.';
    }

    if (window.Capacitor?.Plugins?.App) {
      window.Capacitor.Plugins.App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) maybeAutoSync();
      });
    }
    window.addEventListener('online', () => maybeAutoSync());

    if (state.user?.mode === 'supabase' && window.VOICECARE_SUPABASE.isConfigured()) {
      syncAccountData(state.user, { adoptGuest: true, silent: true }).catch(() => {});
    }
    updateSyncStatusUi();

    // Returning from a Google sign-in redirect (web build): restore the session
    // Supabase already stored, so the patient lands signed in with cloud data.
    if (!state.user && !state.isPasswordRecovery && window.VOICECARE_SUPABASE.isConfigured()) {
      window.VOICECARE_SUPABASE.restoreSession()
        .then(async (user) => {
          if (!user || state.isPasswordRecovery) return;
          state.user = user;
          window.VOICECARE_STORAGE.setUser(user);
          splashStartBtn?.classList.add('hidden');
          refreshDraftBoxForActiveUser();
          applyLanguage();
          await syncAccountData(user, { adoptGuest: true });
          if (state.currentScreen === 'auth' || state.currentScreen === 'splash') {
            navigate('home', { pushHistory: false });
          }
        })
        .catch(() => {});
    }

    // First install waits at Splash until user taps "Get started";
    // returning launches show Splash briefly then continue automatically.
    if (!isFirstInstall) {
      setTimeout(() => {
        if (state.currentScreen === 'splash') {
          if (state.isPasswordRecovery) {
            navigate('auth', { pushHistory: false });
          } else if (state.user) {
            navigate('home', { pushHistory: false });
          } else {
            navigate('auth', { pushHistory: false });
          }
        }
      }, 1300);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
