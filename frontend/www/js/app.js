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
    history: { title: 'Patient History', topbar: false, bottomNav: true },
    doctor: { title: 'Doctor view', topbar: true, bottomNav: true },
    notes: { title: 'Visit notes', topbar: true, bottomNav: false },
    timeline: { title: 'Visit timeline', topbar: true, bottomNav: true },
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
    // Kept for old saved entries that still carry answers from the removed
    // follow-up step; the app no longer asks any questions.
    pendingFollowUpAnswers: [],
    // Visit notes / photos are edited against one saved visit at a time.
    notesEntryId: null,
    // Patient record currently open in the form (null = adding a new patient).
    editingPatientId: null,
    // Prescription files attached while the patient form is open.
    pendingRx: []
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
      const label = lang === 'en' || lang === 'auto' ? 'New consultation' : t.voiceStart || 'New consultation';
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
    $('nav-label-profile').textContent = t.navProfile || 'Patients';
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
      renderPatientScreen();
      maybeAutoSync();
    }
    if (screenName === 'history') {
      renderHistory();
      maybeAutoSync();
    }
    if (screenName === 'doctor') {
      renderDoctorView();
      maybeAutoSync();
    }
    if (screenName === 'timeline') {
      renderTimeline();
      maybeAutoSync();
    }
    if (screenName === 'notes') {
      renderNotesScreen();
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
      : 'Add a patient record';
    const patientCount = window.VOICECARE_STORAGE.getPatients().length;
    if (hasProfile && patientCount > 1) {
      $('home-profile-summary').textContent = `${profile.name || 'Active patient'} · ${patientCount} patients`;
    }
    $('home-history-count').textContent = `${history.length} saved visit${history.length === 1 ? '' : 's'}`;

    const reviewed = history.filter((item) => item.reviewedAt).length;
    const doctorCount = $('home-doctor-count');
    if (doctorCount) {
      doctorCount.textContent = `${history.length} visit${history.length === 1 ? '' : 's'} · ${reviewed} reviewed`;
    }
    const timelineMeta = $('home-timeline-meta');
    if (timelineMeta) {
      const withNotes = history.filter((item) => item.doctorNote || item.prescribedMeds).length;
      timelineMeta.textContent = history.length
        ? `${withNotes} visit note${withNotes === 1 ? '' : 's'} saved`
        : 'Your health over time';
    }
  }

  /**
   * The only summary VoiceCare shows is the English one, whatever language the
   * patient spoke. Returns null when the AI could not translate this visit.
   */
  function englishSummarySections(entry) {
    if (!entry?.englishSummary) return null;
    if (entry.metadata?.englishIsGenerated === false) return null;
    return entry.englishSummary;
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

  const RX_MAX_FILES = 6;
  // A PDF is stored as a base64 data URL in localStorage, which has a small
  // shared quota; images are shrunk first, documents are size-checked.
  const RX_MAX_DOCUMENT_BYTES = 1.2 * 1024 * 1024;

  function patientMetaLine(patient = {}) {
    return [
      patient.age ? `${patient.age} yrs` : '',
      patient.gender || '',
      patient.bloodGroup ? `Blood group ${patient.bloodGroup}` : '',
      patient.allergies ? `Allergies: ${patient.allergies}` : '',
      patient.emergencyContact ? `Emergency: ${patient.emergencyContact}` : ''
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /** Saved patient records, newest last, with the active one highlighted. */
  function renderPatientScreen() {
    const container = $('patient-list');
    if (!container) return;
    const patients = window.VOICECARE_STORAGE.getPatients();
    const activeId = window.VOICECARE_STORAGE.getActivePatientId();
    $('patient-empty')?.classList.toggle('hidden', patients.length > 0);

    container.innerHTML = patients
      .map((patient) => {
        const active = patient.id === activeId;
        const files = window.VOICECARE_STORAGE.getPrescriptions(patient.id);
        const thumbs = files
          .slice(0, 4)
          .map((file) =>
            file.kind === 'image'
              ? `<img class="photo-thumb-sm" src="${escapeHtml(file.dataUrl)}" alt="Prescription photo" />`
              : `<span class="rx-doc-chip">PDF</span>`
          )
          .join('');
        return `
          <article class="patient-card${active ? ' is-active' : ''}">
            <div class="patient-head">
              <div>
                <p class="patient-name">${escapeHtml(patient.name || 'Unnamed patient')}</p>
                <p class="patient-meta">${escapeHtml(patientMetaLine(patient) || 'No age, blood group or allergy recorded')}</p>
              </div>
              ${active ? '<span class="badge badge-ok">Active</span>' : ''}
            </div>
            ${
              files.length
                ? `<div class="photo-strip">${thumbs}${files.length > 4 ? `<span class="rx-doc-chip">+${files.length - 4}</span>` : ''}</div>`
                : '<p class="panel-sub">No prescription attached.</p>'
            }
            <div class="item-actions">
              <button class="btn btn-secondary btn-sm" data-patient-edit="${escapeHtml(patient.id)}" type="button">Edit</button>
              ${active ? '' : `<button class="btn btn-quiet btn-sm" data-patient-use="${escapeHtml(patient.id)}" type="button">Use</button>`}
              <button class="btn btn-danger btn-sm" data-patient-delete="${escapeHtml(patient.id)}" type="button">Delete</button>
            </div>
          </article>`;
      })
      .join('');
  }

  function openPatientForm(patient) {
    state.editingPatientId = patient?.id || null;
    state.pendingRx = patient ? window.VOICECARE_STORAGE.getPrescriptions(patient.id) : [];

    $('patient-form-title').textContent = patient ? 'Edit patient' : 'New patient';
    $('profile-name').value = patient?.name || '';
    $('profile-age').value = patient?.age || '';
    $('profile-gender').value = patient?.gender || '';
    $('profile-blood').value = patient?.bloodGroup || '';
    $('profile-allergies').value = patient?.allergies || '';
    $('profile-emergency').value = patient?.emergencyContact || '';
    renderPendingPrescriptions();

    $('profile-form-wrap').classList.remove('hidden');
    $('btn-add-patient')?.classList.add('hidden');
    $('patient-list')?.classList.add('hidden');
    $('patient-empty')?.classList.add('hidden');
    $('profile-form-wrap').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function closePatientForm() {
    $('profile-form-wrap')?.classList.add('hidden');
    $('btn-add-patient')?.classList.remove('hidden');
    $('patient-list')?.classList.remove('hidden');
    state.editingPatientId = null;
    state.pendingRx = [];
    $('profile-form')?.reset();
    renderPatientScreen();
  }

  function renderPendingPrescriptions() {
    const list = $('rx-list');
    if (!list) return;
    if (!state.pendingRx.length) {
      list.innerHTML = '<p class="panel-sub">No prescription attached yet.</p>';
      return;
    }
    list.innerHTML = state.pendingRx
      .map((file) =>
        file.kind === 'image'
          ? `<figure class="photo-item">
               <img class="photo-thumb" src="${escapeHtml(file.dataUrl)}" alt="Prescription photo" />
               <button class="photo-remove" type="button" data-rx-remove="${escapeHtml(file.id)}" aria-label="Remove prescription">×</button>
             </figure>`
          : `<div class="rx-doc-row">
               <span class="rx-doc-chip">PDF</span>
               <span class="rx-doc-name">${escapeHtml(file.name || 'Prescription document')}</span>
               <button class="photo-remove photo-remove-inline" type="button" data-rx-remove="${escapeHtml(file.id)}" aria-label="Remove prescription">×</button>
             </div>`
      )
      .join('');
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(file);
    });
  }

  /** Adds prescription photos/documents to the patient being edited. */
  async function addPrescriptionFiles(files) {
    for (const file of Array.from(files || [])) {
      if (state.pendingRx.length >= RX_MAX_FILES) {
        showToast(`A patient can have up to ${RX_MAX_FILES} prescription files.`);
        break;
      }
      const isImage = String(file.type || '').startsWith('image/');
      try {
        if (isImage) {
          const dataUrl = await shrinkImage(file);
          state.pendingRx.push({
            id: `rx_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            kind: 'image',
            name: file.name || 'Prescription photo',
            dataUrl,
            addedAt: new Date().toISOString()
          });
        } else if (file.type === 'application/pdf') {
          if (file.size > RX_MAX_DOCUMENT_BYTES) {
            showToast('That PDF is too large. Please choose one under 1.2 MB, or take a photo instead.');
            continue;
          }
          const dataUrl = await readFileAsDataUrl(file);
          state.pendingRx.push({
            id: `rx_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            kind: 'document',
            name: file.name || 'Prescription document',
            dataUrl,
            addedAt: new Date().toISOString()
          });
        } else {
          showToast('Only photos or PDF documents can be attached.');
        }
      } catch (err) {
        showToast(err.message || 'Could not attach that file.');
      }
    }
    renderPendingPrescriptions();
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

    $('summary-lang-badge').textContent = 'English';

    const meta = entry.metadata || {};
    $('summary-source-badge').textContent =
      meta.source === 'gemini'
        ? `Organised with Gemini AI${meta.model ? ` · ${meta.model}` : ''}`
        : `Basic local extractor used — the AI model was unavailable. Tap Regenerate to try again.`;

    // English only. The patient's own words are still one tap away in the
    // "Patient's words" tab, but no second-language summary is ever shown.
    const english = englishSummarySections(entry);
    $('summary-english-container').innerHTML = english
      ? buildSummarySectionHtml(english)
      : `<div class="alert alert-warning" style="display: block;">
           <p class="alert-title">English summary not ready</p>
           <p>The AI could not translate this visit yet. Tap <strong>Regenerate</strong> to try again.</p>
         </div>`;

    renderPossibleSymptoms(entry);

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
      "These are the patient's own words, repeated so they are seen first. VoiceCare does not decide how serious they are.";
  }

  /** AI suggestions, kept visually separate from the patient's own symptoms. */
  function renderPossibleSymptoms(entry) {
    const panel = $('summary-possible-panel');
    const list = $('summary-possible-list');
    if (!panel || !list) return;
    const items = (Array.isArray(entry.possibleSymptoms) ? entry.possibleSymptoms : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 6);
    if (!items.length) {
      panel.classList.add('hidden');
      list.innerHTML = '';
      return;
    }
    panel.classList.remove('hidden');
    list.innerHTML = items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  }

  /**
   * Patient details for a visit. Newer visits store the patient id, so edits to
   * that patient's record (name, blood group, allergies) show on old summaries
   * too instead of the short details captured when the visit was created.
   */
  function entryQuickInfo(entry) {
    const live = window.VOICECARE_STORAGE.getPatientById(entry?.patientId);
    return live || entry?.quickInfo || window.VOICECARE_STORAGE.getProfile();
  }

  function renderQuickInfoStrip(entry) {
    const strip = $('summary-quickinfo-strip');
    const profile = entryQuickInfo(entry);
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
    // The form edits the English summary the doctor reads, because that is the
    // only summary the app shows or shares.
    const s = entry.englishSummary || entry.summary || {};

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
    $('pdf-meta-line').textContent = `${infoLine ? `${infoLine} • ` : ''}Prepared: ${dateStr}`;

    const flags = (Array.isArray(entry.urgentFlags) ? entry.urgentFlags : []).filter(Boolean);
    const flagHtml = flags.length
      ? `<section class="alert alert-danger" style="display:block; margin-bottom: 12px;">
           <p class="alert-title">Urgent words said by the patient</p>
           <ul class="urgent-flag-list">${flags.map((flag) => `<li>${escapeHtml(flag)}</li>`).join('')}</ul>
           <p class="urgent-call-line">If this is an emergency, call 108.</p>
         </section>`
      : '';

    const english = englishSummarySections(entry);

    const possible = (Array.isArray(entry.possibleSymptoms) ? entry.possibleSymptoms : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 6);
    const possibleHtml = possible.length
      ? `<div class="possible-panel" style="margin-top: 12px;">
           <p class="summary-lang-label">Possible symptoms to ask about</p>
           <p class="panel-sub">AI suggestions — not the patient's words. Not a diagnosis.</p>
           <ul class="record-list">${possible.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
         </div>`
      : '';

    $('pdf-preview-body').innerHTML = `
      ${flagHtml}
      <p class="summary-lang-label">Summary for the doctor · English</p>
      ${english
        ? buildSummarySectionHtml(english)
        : `<div class="alert alert-warning" style="display: block;">
             <p class="alert-title">English summary not ready</p>
             <p>Tap Regenerate to try the translation again.</p>
           </div>`}
      ${possibleHtml}
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
        // Ties the visit to a patient record so later corrections show here.
        patientId: window.VOICECARE_STORAGE.getActivePatientId(),
        language: state.language,
        // Follow the words the patient actually used, not the menu language: a
        // patient can type Hindi while the app itself is in English.
        detectedLanguage: result.metadata?.detectedLanguage || state.language,
        languageLabel: result.metadata?.detectedLanguageLabel || langObj.nativeName,
        summary: result.summary,
        englishSummary: result.englishSummary,
        urgentFlags: Array.isArray(result.urgentFlags) ? result.urgentFlags : [],
        // AI suggestions shown separately from the patient's own symptoms.
        possibleSymptoms: Array.isArray(result.possibleSymptoms) ? result.possibleSymptoms : [],
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

      // The quick-info card follows the account, but only fills a blank card:
      // details already saved on this phone always win.
      const cloudProfile = await window.VOICECARE_SUPABASE.loadCloudProfile?.(user)?.catch(() => null);
      if (cloudProfile?.ok && cloudProfile.profile) {
        const localProfile = window.VOICECARE_STORAGE.getProfile();
        const hasLocal = Boolean(
          localProfile.name || localProfile.age || localProfile.bloodGroup || localProfile.allergies
        );
        if (!hasLocal) window.VOICECARE_STORAGE.saveProfile(cloudProfile.profile);
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
        // A visit deleted on this phone must not come back from the cloud.
        const deletedIds = window.VOICECARE_STORAGE.getDeletedIds();
        const deletedSet = new Set(deletedIds);
        for (const id of deletedIds) {
          window.VOICECARE_SUPABASE.deleteCloudSummary?.(user, id);
        }
        if (deletedIds.length) window.VOICECARE_STORAGE.clearDeletedIds();

        const cloudSummaries = sumRes.items.filter((c) => c?.id && !deletedSet.has(c.id));
        const localList = window.VOICECARE_STORAGE.getHistory(user.uid);
        const cloudMap = new Map(cloudSummaries.map((c) => [c.id, c]));
        const mergedMap = new Map();

        for (const c of cloudSummaries) {
          mergedMap.set(c.id, { ...c, synced: true });
        }

        // A visit that exists only on this phone is kept and re-uploaded. It is
        // never dropped just because the cloud copy is missing.
        const unsyncedToUpload = [];
        for (const l of localList) {
          if (!l || !l.id || deletedSet.has(l.id)) continue;
          const c = cloudMap.get(l.id);
          if (!c) {
            mergedMap.set(l.id, { ...l, synced: false });
            unsyncedToUpload.push(l);
            continue;
          }
          const lTime = String(l.updatedAt || l.createdAt || '');
          const cTime = String(c.updatedAt || c.createdAt || '');
          if (lTime > cTime) {
            mergedMap.set(l.id, { ...l, synced: false });
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

  /** English concern, used everywhere the doctor reads a visit title. */
  function entryConcern(entry) {
    return entry?.englishSummary?.mainHealthConcern || entry?.summary?.mainHealthConcern || 'Health summary';
  }

  function renderHistory() {
    const query = ($('history-search').value || '').trim().toLowerCase();
    const list = window.VOICECARE_STORAGE.getHistory().filter((item) => {
      if (!query) return true;
      const english = item.englishSummary || {};
      const hay = `${english.mainHealthConcern || ''} ${(english.symptoms || []).join(' ')} ${item.patientText || ''}`.toLowerCase();
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
              <span class="item-title">${escapeHtml(entryConcern(item))}</span>
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

  function formatEntryDate(entry) {
    return new Date(entry?.updatedAt || entry?.createdAt || Date.now()).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  }

  /**
   * Applies a change to one saved visit: local storage first (instant, works
   * offline), then the cloud copy in the background.
   */
  function updateEntry(id, patch) {
    const entry = window.VOICECARE_STORAGE.getHistory().find((item) => item.id === id);
    if (!entry) return null;
    const updated = { ...entry, ...patch, synced: false, updatedAt: new Date().toISOString() };
    window.VOICECARE_STORAGE.saveHistoryEntry(updated);
    if (state.currentEntry?.id === id) state.currentEntry = updated;
    persistEntryToCloud(updated);
    return updated;
  }

  /** Doctor view: one card per visit, with review state and visit notes. */
  function renderDoctorView() {
    const container = $('doctor-list');
    if (!container) return;
    const list = window.VOICECARE_STORAGE.getHistory();

    if (!list.length) {
      container.innerHTML = `<div class="empty-state">No visits yet. Describe a health concern and the summary will appear here for your doctor.</div>`;
      return;
    }

    container.innerHTML = list
      .map((entry) => {
        // The name is already the card title, so the meta line only adds the rest.
        const info = entryQuickInfo(entry);
        const quick = [
          info.age ? `${info.age} yrs` : '',
          info.gender || '',
          info.bloodGroup ? `Blood group ${info.bloodGroup}` : '',
          info.allergies ? `Allergies: ${info.allergies}` : ''
        ]
          .filter(Boolean)
          .join(' · ');
        const flags = (Array.isArray(entry.urgentFlags) ? entry.urgentFlags : []).filter(Boolean).slice(0, 4);
        const photos = window.VOICECARE_STORAGE.getPhotos(entry.id);
        const reviewed = Boolean(entry.reviewedAt);
        return `
          <article class="doctor-card${reviewed ? ' is-reviewed' : ''}">
            <div class="doctor-card-head">
              <div>
                <p class="doctor-name">${escapeHtml((entry.quickInfo?.name || entry.patientName) || 'Patient')}</p>
                <p class="doctor-meta">${escapeHtml(quick || 'Quick-Info Card not filled')}</p>
              </div>
              <span class="badge${reviewed ? ' badge-ok' : ''}">${reviewed ? 'Reviewed' : 'New'}</span>
            </div>
            <p class="doctor-concern">${escapeHtml(entryConcern(entry))}</p>
            <p class="doctor-meta">${escapeHtml(formatEntryDate(entry))}</p>
            ${flags.length ? `<ul class="urgent-flag-list">${flags.map((flag) => `<li>${escapeHtml(flag)}</li>`).join('')}</ul>` : ''}
            ${entry.doctorNote ? `<p class="doctor-note"><strong>Doctor's note:</strong> ${escapeHtml(entry.doctorNote)}</p>` : ''}
            ${entry.prescribedMeds ? `<p class="doctor-note"><strong>Medicines:</strong> ${escapeHtml(entry.prescribedMeds)}</p>` : ''}
            ${entry.nextVisitAt ? `<p class="doctor-meta">Next visit: ${escapeHtml(entry.nextVisitAt)}</p>` : ''}
            ${photos.length ? `<div class="photo-strip">${photos.map((photo) => `<img class="photo-thumb-sm" src="${escapeHtml(photo.dataUrl)}" alt="Attached report photo" />`).join('')}</div>` : ''}
            <div class="item-actions">
              <button class="btn btn-secondary btn-sm" data-doctor-open="${escapeHtml(entry.id)}" type="button">Open summary</button>
              <button class="btn btn-quiet btn-sm" data-doctor-notes="${escapeHtml(entry.id)}" type="button">Visit notes</button>
              <button class="btn ${reviewed ? 'btn-quiet' : 'btn-primary'} btn-sm" data-doctor-review="${escapeHtml(entry.id)}" type="button">${reviewed ? 'Reviewed ✓' : 'Mark reviewed'}</button>
            </div>
          </article>`;
      })
      .join('');
  }

  function toggleReviewed(id) {
    const entry = window.VOICECARE_STORAGE.getHistory().find((item) => item.id === id);
    if (!entry) return;
    const reviewed = !entry.reviewedAt;
    updateEntry(id, { reviewedAt: reviewed ? new Date().toISOString() : null });
    renderDoctorView();
    renderHomeStats();
    showToast(reviewed ? 'Marked as reviewed.' : 'Marked as not reviewed.');
  }

  function openNotesScreen(entryId) {
    const entry = window.VOICECARE_STORAGE.getHistory().find((item) => item.id === entryId);
    if (!entry) {
      showToast('That visit could not be found.');
      return;
    }
    state.notesEntryId = entryId;
    renderNotesScreen();
    navigate('notes');
  }

  function renderNotesScreen() {
    const entry = window.VOICECARE_STORAGE.getHistory().find((item) => item.id === state.notesEntryId);
    if (!entry) return;
    $('notes-subtitle').textContent = `${entryConcern(entry)} · ${formatEntryDate(entry)}`;
    $('note-doctor-said').value = entry.doctorNote || '';
    $('note-medicines').value = entry.prescribedMeds || '';
    $('note-next-visit').value = String(entry.nextVisitAt || '').slice(0, 10);
    renderPhotos();
  }

  function renderPhotos() {
    const grid = $('note-photos');
    if (!grid) return;
    const photos = window.VOICECARE_STORAGE.getPhotos(state.notesEntryId);
    if (!photos.length) {
      grid.innerHTML = '<p class="panel-sub" style="grid-column: 1 / -1;">No photos added yet.</p>';
      return;
    }
    grid.innerHTML = photos
      .map(
        (photo) => `
        <figure class="photo-item">
          <img class="photo-thumb" src="${escapeHtml(photo.dataUrl)}" alt="Attached report photo" />
          <button class="photo-remove" type="button" data-photo-remove="${escapeHtml(photo.id)}" aria-label="Remove photo">×</button>
        </figure>`
      )
      .join('');
  }

  /**
   * Shrinks a camera photo to a small JPEG before it is stored on the phone.
   * Full-size 4 MB photos would fill the app's storage after two pictures.
   */
  function shrinkImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read that photo.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('That photo format is not supported on this phone.'));
        img.onload = () => {
          try {
            const maxSide = 900;
            const scale = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.7));
          } catch {
            reject(new Error('Could not prepare that photo.'));
          }
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  async function addPhotos(files) {
    const entryId = state.notesEntryId;
    if (!entryId) return;
    const existing = window.VOICECARE_STORAGE.getPhotos(entryId);
    const room = 4 - existing.length;
    if (room <= 0) {
      showToast('You can keep up to 4 photos per visit.');
      return;
    }
    const picked = Array.from(files || []).slice(0, room);
    if (!picked.length) return;

    const added = [];
    for (const [index, file] of picked.entries()) {
      if (!String(file.type || '').startsWith('image/')) continue;
      try {
        const dataUrl = await shrinkImage(file);
        added.push({ id: `ph_${Date.now()}_${index}`, dataUrl, addedAt: new Date().toISOString() });
      } catch (err) {
        showToast(err.message || 'Could not add that photo.');
      }
    }

    if (added.length) {
      window.VOICECARE_STORAGE.savePhotos(entryId, [...existing, ...added]);
      updateEntry(entryId, { photosCount: window.VOICECARE_STORAGE.countPhotos(entryId) });
      renderPhotos();
      showToast(`${added.length} photo${added.length === 1 ? '' : 's'} attached.`);
    }
  }

  /** Timeline: every visit grouped by month, oldest month last. */
  function renderTimeline() {
    const container = $('timeline-list');
    if (!container) return;
    const list = window.VOICECARE_STORAGE.getHistory();

    if (!list.length) {
      container.innerHTML = `<div class="empty-state">No visits yet. Describe your first health concern to start your timeline.</div>`;
      return;
    }

    const groups = [];
    const byMonth = new Map();
    for (const entry of list) {
      const date = new Date(entry.updatedAt || entry.createdAt || Date.now());
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!byMonth.has(key)) {
        const group = {
          key,
          label: date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
          items: []
        };
        byMonth.set(key, group);
        groups.push(group);
      }
      byMonth.get(key).items.push(entry);
    }

    container.innerHTML = groups
      .map(
        (group) => `
        <section class="timeline-group">
          <p class="timeline-month">${escapeHtml(group.label)}</p>
          <ul class="timeline-items">
            ${group.items
              .map(
                (entry) => `
              <li class="timeline-item">
                <span class="timeline-dot${entry.reviewedAt ? ' is-reviewed' : ''}" aria-hidden="true"></span>
                <button class="timeline-card" type="button" data-timeline-open="${escapeHtml(entry.id)}">
                  <span class="timeline-date">${escapeHtml(formatEntryDate(entry))}</span>
                  <span class="timeline-title">${escapeHtml(entryConcern(entry))}</span>
                  <span class="timeline-meta">${escapeHtml(entry.languageLabel || 'English')}${entry.reviewedAt ? ' · Reviewed' : ''}${(entry.urgentFlags || []).length ? ' · Urgent words' : ''}</span>
                </button>
              </li>`
              )
              .join('')}
          </ul>
        </section>`
      )
      .join('');
  }

  function updateOfflineBanner() {
    const banner = $('offline-banner');
    if (!banner) return;
    banner.classList.toggle('hidden', navigator.onLine !== false);
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
    $('tile-doctor').addEventListener('click', () => navigate('doctor'));
    $('tile-timeline').addEventListener('click', () => navigate('timeline'));
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
      // Offline: keep the words safe and explain instead of failing silently.
      if (navigator.onLine === false) {
        window.VOICECARE_STORAGE.setDraftText(text);
        updateOfflineBanner();
        showToast('You are offline. Your description is saved as a draft — tap Generate again when the internet returns.');
        return;
      }

      state.currentEntry = null;
      state.pendingFollowUpAnswers = [];
      runAiSummarization({ patientText: text, endpoint: 'summarize' });
    });

    // 5b. Patient records — add or edit one patient, with their prescription.
    $('profile-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = String($('profile-name').value || '').trim();
      if (!name) {
        showToast("Please enter the patient's name.");
        $('profile-name').focus();
        return;
      }

      const editingId = state.editingPatientId;
      const previous = editingId ? window.VOICECARE_STORAGE.getPatientById(editingId) : null;
      const patient = window.VOICECARE_STORAGE.savePatient({
        id: editingId,
        name,
        age: $('profile-age').value,
        gender: $('profile-gender').value,
        bloodGroup: $('profile-blood').value,
        allergies: $('profile-allergies').value,
        emergencyContact: $('profile-emergency').value
      });
      window.VOICECARE_STORAGE.savePrescriptions(patient.id, state.pendingRx);
      window.VOICECARE_STORAGE.setActivePatient(patient.id);
      const profile = window.VOICECARE_STORAGE.getProfile();

      // Keep every visit of this patient in step with the corrected details, so
      // an old summary never keeps a short/outdated name or missing blood group.
      for (const item of window.VOICECARE_STORAGE.getHistory()) {
        const linked = item.patientId === patient.id;
        const byOldName =
          !item.patientId &&
          previous?.name &&
          item.quickInfo?.name === previous.name;
        if (!linked && !byOldName) continue;
        const updated = {
          ...item,
          patientId: patient.id,
          quickInfo: profile,
          synced: false,
          updatedAt: new Date().toISOString()
        };
        window.VOICECARE_STORAGE.saveHistoryEntry(updated);
        if (state.currentEntry?.id === item.id) state.currentEntry = updated;
        persistEntryToCloud(updated);
      }

      closePatientForm();
      renderHomeStats();
      if (state.currentEntry && state.currentScreen === 'summary') renderSummaryScreen();

      // The active patient is account data, so keep a copy in Supabase too (never
      // inside a summary); a new phone fills its blank record from there.
      if (state.user?.mode === 'supabase') {
        window.VOICECARE_SUPABASE?.syncProfileToCloud?.(state.user, profile)?.catch?.(() => {});
      }
      const rxCount = window.VOICECARE_STORAGE.getPrescriptions(patient.id).length;
      showToast(
        `${patient.name} saved as the active patient${rxCount ? ` · ${rxCount} prescription file${rxCount === 1 ? '' : 's'}` : ''}.`
      );
    });

    $('btn-add-patient')?.addEventListener('click', () => openPatientForm(null));
    $('btn-cancel-patient')?.addEventListener('click', () => closePatientForm());

    $('patient-list')?.addEventListener('click', (event) => {
      const editBtn = event.target.closest('[data-patient-edit]');
      if (editBtn) {
        const patient = window.VOICECARE_STORAGE.getPatients().find(
          (item) => item.id === editBtn.getAttribute('data-patient-edit')
        );
        if (patient) openPatientForm(patient);
        return;
      }
      const useBtn = event.target.closest('[data-patient-use]');
      if (useBtn) {
        const id = useBtn.getAttribute('data-patient-use');
        window.VOICECARE_STORAGE.setActivePatient(id);
        const patient = window.VOICECARE_STORAGE.getPatients().find((item) => item.id === id);
        renderPatientScreen();
        renderHomeStats();
        showToast(`${patient?.name || 'Patient'} is now the active patient.`);
        return;
      }
      const deleteBtn = event.target.closest('[data-patient-delete]');
      if (deleteBtn) {
        const id = deleteBtn.getAttribute('data-patient-delete');
        const patient = window.VOICECARE_STORAGE.getPatients().find((item) => item.id === id);
        if (!patient) return;
        if (!window.confirm(`Delete ${patient.name || 'this patient'} and their prescription? This cannot be undone.`)) {
          return;
        }
        window.VOICECARE_STORAGE.deletePatient(id);
        renderPatientScreen();
        renderHomeStats();
        showToast('Patient record deleted.');
      }
    });

    $('btn-rx-photos')?.addEventListener('click', () => $('rx-photos-input')?.click());
    $('btn-rx-camera')?.addEventListener('click', () => $('rx-camera-input')?.click());
    $('btn-rx-document')?.addEventListener('click', () => $('rx-document-input')?.click());
    ['rx-photos-input', 'rx-camera-input', 'rx-document-input'].forEach((id) => {
      $(id)?.addEventListener('change', async (event) => {
        const input = event.target;
        await addPrescriptionFiles(input.files);
        input.value = '';
      });
    });
    $('rx-list')?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-rx-remove]');
      if (!btn) return;
      state.pendingRx = state.pendingRx.filter(
        (file) => file.id !== btn.getAttribute('data-rx-remove')
      );
      renderPendingPrescriptions();
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
        englishSummary: updatedSummary,
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

    // 11b. Doctor view, visit notes, photos and timeline
    $('btn-doctor-timeline')?.addEventListener('click', () => navigate('timeline'));
    $('btn-doctor-new')?.addEventListener('click', () => {
      state.currentEntry = null;
      navigate('input');
    });

    $('doctor-list')?.addEventListener('click', (event) => {
      const openBtn = event.target.closest('[data-doctor-open]');
      if (openBtn) {
        const id = openBtn.getAttribute('data-doctor-open');
        const found = window.VOICECARE_STORAGE.getHistory().find((x) => x.id === id);
        if (!found) return;
        state.currentEntry = found;
        renderSummaryScreen();
        navigate('summary');
        return;
      }
      const notesBtn = event.target.closest('[data-doctor-notes]');
      if (notesBtn) {
        openNotesScreen(notesBtn.getAttribute('data-doctor-notes'));
        return;
      }
      const reviewBtn = event.target.closest('[data-doctor-review]');
      if (reviewBtn) toggleReviewed(reviewBtn.getAttribute('data-doctor-review'));
    });

    $('timeline-list')?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-timeline-open]');
      if (!btn) return;
      const found = window.VOICECARE_STORAGE.getHistory().find(
        (x) => x.id === btn.getAttribute('data-timeline-open')
      );
      if (!found) return;
      state.currentEntry = found;
      renderSummaryScreen();
      navigate('summary');
    });

    $('notes-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const id = state.notesEntryId;
      if (!id) return;
      const noteText = (value, max) => String(value || '').trim().slice(0, max);
      updateEntry(id, {
        doctorNote: noteText($('note-doctor-said').value, 600),
        prescribedMeds: noteText($('note-medicines').value, 400),
        nextVisitAt: $('note-next-visit').value || null
      });
      renderHomeStats();
      showToast('Visit notes saved.');
    });

    $('btn-add-photo')?.addEventListener('click', () => $('note-photo-input')?.click());

    $('note-photo-input')?.addEventListener('change', async (event) => {
      const input = event.target;
      await addPhotos(input.files);
      input.value = '';
    });

    $('note-photos')?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-photo-remove]');
      if (!btn || !state.notesEntryId) return;
      const remaining = window.VOICECARE_STORAGE
        .getPhotos(state.notesEntryId)
        .filter((photo) => photo.id !== btn.getAttribute('data-photo-remove'));
      window.VOICECARE_STORAGE.savePhotos(state.notesEntryId, remaining);
      updateEntry(state.notesEntryId, { photosCount: remaining.length });
      renderPhotos();
    });

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
    updateOfflineBanner();
    window.addEventListener('online', () => {
      updateOfflineBanner();
      showToast('Back online. You can generate summaries again.');
      maybeAutoSync();
    });
    window.addEventListener('offline', updateOfflineBanner);

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
