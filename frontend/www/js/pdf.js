/**
 * VoiceCare PDF Report & Native Sharing Module
 *
 * Uses jsPDF for a doctor-friendly A4 report and Capacitor Filesystem + Share on
 * Android (Web Share / download fallback elsewhere).
 *
 * Two things this file has to get right:
 * 1. Hindi/Kannada must be readable in the PDF. jsPDF's built-in Helvetica
 *    cannot draw those glyphs at all, so non-Latin text is laid out on a canvas
 *    with the phone's own fonts and inserted as an image. That keeps the PDF
 *    small (no 2 MB font file) and works for every Indian script.
 * 2. The doctor sees the patient's language and English side by side, plus the
 *    patient's exact original words and any urgency flags they actually said.
 */

window.VOICECARE_PDF = (() => {
  const NOT_MENTIONED = 'Not mentioned by patient';

  const SECTIONS = [
    ['mainHealthConcern', 'Main health concern'],
    ['symptoms', 'Symptoms'],
    ['duration', 'Duration'],
    ['severity', 'Severity'],
    ['relevantMedicalHistory', 'Relevant medical history'],
    ['currentMedications', 'Current medicines'],
    ['additionalObservations', 'Additional observations'],
    ['questionsToAskDoctor', 'Questions to ask the doctor']
  ];

  // Canvas pixels per PDF millimetre. 3.4 keeps text crisp on a phone screen
  // and in print without making the PDF heavy.
  const PX_PER_MM = 3.4;

  function toPdfAscii(value) {
    return String(value || '')
      .replace(/[—–]/g, '-')
      .replace(/[•]/g, '*')
      .replace(/[^\x20-\x7E\n]/g, '')
      .trim();
  }

  function hasNativeScript(value) {
    return /[^\x00-\x7F]/.test(String(value || ''));
  }

  function safePdfLanguageLabel(entry) {
    const map = { en: 'English', hi: 'Hindi', kn: 'Kannada', auto: 'Multilingual' };
    if (entry.language && map[entry.language]) return map[entry.language];
    return toPdfAscii(entry.languageLabel) || 'English';
  }

  function sectionValueText(value) {
    if (Array.isArray(value)) {
      const items = value.filter((item) => typeof item === 'string' && item.trim());
      return items.length ? items.map((item) => `- ${item}`).join('\n') : NOT_MENTIONED;
    }
    return String(value || '').trim() || NOT_MENTIONED;
  }

  function patientLine(entry) {
    const info = entry.quickInfo || {};
    const parts = [];
    if (info.name) parts.push(info.name);
    if (info.age) parts.push(`${info.age} yrs`);
    if (info.gender) parts.push(info.gender);
    if (info.bloodGroup) parts.push(`Blood group ${info.bloodGroup}`);
    if (info.allergies) parts.push(`Allergies: ${info.allergies}`);
    if (info.emergencyContact) parts.push(`Emergency: ${info.emergencyContact}`);
    return parts.join(' | ');
  }

  /** Plain-text version, used for Copy and for chat apps without attachments. */
  function formatPlainTextSummary(entry) {
    const dateStr = new Date(entry.updatedAt || entry.createdAt).toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });

    const info = entry.quickInfo || {};
    const flags = Array.isArray(entry.urgentFlags) ? entry.urgentFlags : [];

    const lines = [
      'VOICECARE - PATIENT SUMMARY FOR DOCTOR',
      `Prepared on: ${dateStr}`,
      info.name ? `Patient: ${info.name}${info.age ? ` | ${info.age} yrs` : ''}${info.gender ? ` | ${info.gender}` : ''}` : null,
      info.bloodGroup ? `Blood group: ${info.bloodGroup}` : null,
      info.allergies ? `Allergies: ${info.allergies}` : null,
      info.emergencyContact ? `Emergency contact: ${info.emergencyContact}` : null,
      '----------------------------------------'
    ].filter(Boolean);

    if (flags.length) {
      lines.push('URGENT WORDS SAID BY THE PATIENT:');
      flags.forEach((flag) => lines.push(`! ${flag}`));
      lines.push('If this is an emergency, call 108.');
      lines.push('----------------------------------------');
    }

    // English only: the app never prints a second-language summary.
    lines.push('SUMMARY (ENGLISH)');
    SECTIONS.forEach(([key, title], index) => {
      lines.push(
        '',
        `${index + 1}. ${title}:`,
        sectionValueText(entry.englishSummary?.[key] ?? entry.summary?.[key])
      );
    });

    const answers = (entry.followUpAnswers || []).filter((a) => a && a.answer);
    if (answers.length) {
      lines.push('', 'FOLLOW-UP ANSWERS GIVEN BY THE PATIENT:');
      answers.forEach((a) => lines.push(`Q: ${a.question}`, `A: ${a.answer}`));
    }

    const possible = (Array.isArray(entry.possibleSymptoms) ? entry.possibleSymptoms : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 6);
    if (possible.length) {
      lines.push('', 'POSSIBLE SYMPTOMS TO ASK ABOUT (AI SUGGESTIONS — NOT THE PATIENT\'S WORDS):');
      possible.forEach((item) => lines.push(`- ${item}`));
    }

    lines.push(
      '',
      '----------------------------------------',
      'Prepared by the patient with VoiceCare AI as a communication aid.',
      'NOT a medical diagnosis, prescription or verified medical record.',
      'VoiceCare repeats what the patient said and adds no medical opinion.'
    );

    return lines.join('\n');
  }

  /* ------------------------- canvas text rendering ------------------------- */

  function fontSpec(fontPx, bold) {
    return `${bold ? '600 ' : ''}${fontPx}px "Noto Sans", "Nirmala UI", "Segoe UI", system-ui, sans-serif`;
  }

  function wrapLines(ctx, text, maxWidthPx) {
    const paragraphs = String(text ?? '').split('\n');
    const lines = [];
    for (const paragraph of paragraphs) {
      if (!paragraph.trim()) {
        lines.push('');
        continue;
      }
      const words = paragraph.split(/\s+/);
      let current = '';
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (ctx.measureText(candidate).width <= maxWidthPx || !current) {
          current = candidate;
        } else {
          lines.push(current);
          current = word;
        }
      }
      if (current) lines.push(current);
    }
    return lines;
  }

  /**
   * Draws one text block (any script) into the PDF as a transparent PNG and
   * returns the new y position in millimetres.
   */
  function drawTextBlock(doc, text, xMm, yMm, widthMm, options = {}) {
    const fontPt = options.fontSize || 10.5;
    const bold = Boolean(options.bold);
    const colour = options.colour || '#1e293b';
    const fontPx = Math.max(11, Math.round((fontPt * 0.3528) * PX_PER_MM * 1.15));
    const lineHeightPx = Math.round(fontPx * 1.4);
    const widthPx = Math.round(widthMm * PX_PER_MM);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = fontSpec(fontPx, bold);
    const lines = wrapLines(ctx, text, widthPx);
    const heightPx = Math.max(lineHeightPx, lines.length * lineHeightPx);

    canvas.width = widthPx;
    canvas.height = heightPx;
    const draw = canvas.getContext('2d');
    draw.font = fontSpec(fontPx, bold);
    draw.fillStyle = colour;
    draw.textBaseline = 'top';
    lines.forEach((line, index) => {
      draw.fillText(line, 0, index * lineHeightPx);
    });

    const heightMm = heightPx / PX_PER_MM;
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', xMm, yMm, widthMm, heightMm);
    return yMm + heightMm;
  }

  function measureBlockHeightMm(text, widthMm, fontSize = 10.5, bold = false) {
    const fontPx = Math.max(11, Math.round((fontSize * 0.3528) * PX_PER_MM * 1.15));
    const lineHeightPx = Math.round(fontPx * 1.4);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = fontSpec(fontPx, bold);
    const lines = wrapLines(ctx, text, Math.round(widthMm * PX_PER_MM));
    return (Math.max(lineHeightPx, lines.length * lineHeightPx)) / PX_PER_MM;
  }

  /* ------------------------------- document ------------------------------- */

  function createPdfDocument(entry) {
    const jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDFCtor) return null;

    const doc = new jsPDFCtor({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 14;
    const maxWidth = pageWidth - margin * 2;
    let y = 16;

    const ensureSpace = (needed) => {
      if (y + needed > 278) {
        doc.addPage();
        y = 18;
        return true;
      }
      return false;
    };

    // Header
    doc.setFillColor(15, 118, 110);
    doc.rect(0, 0, pageWidth, 26, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.text('VoiceCare - Patient Summary for Doctor', margin, 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Organised from the patient\'s own words. Not a diagnosis.', margin, 20);

    y = 34;
    doc.setTextColor(30, 41, 59);

    const dateStr = new Date(entry.updatedAt || entry.createdAt).toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
    doc.setFontSize(9.5);
    doc.text(`Prepared: ${toPdfAscii(dateStr)}`, margin, y);
    doc.text(`Patient language: ${safePdfLanguageLabel(entry)}`, pageWidth - margin, y, {
      align: 'right'
    });
    y += 6;

    // Quick-info card
    const info = entry.quickInfo || {};
    const infoBits = [];
    if (info.name) infoBits.push(`Name: ${info.name}`);
    if (info.age) infoBits.push(`Age: ${info.age}`);
    if (info.gender) infoBits.push(`Gender: ${info.gender}`);
    if (info.bloodGroup) infoBits.push(`Blood group: ${info.bloodGroup}`);
    if (info.allergies) infoBits.push(`Allergies: ${info.allergies}`);
    if (info.emergencyContact) infoBits.push(`Emergency contact: ${info.emergencyContact}`);

    if (infoBits.length) {
      const boxHeight = 16;
      ensureSpace(boxHeight + 6);
      doc.setFillColor(240, 249, 255);
      doc.setDrawColor(186, 230, 253);
      doc.roundedRect(margin, y, maxWidth, boxHeight, 2, 2, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.6);
      doc.setTextColor(12, 74, 110);
      doc.text('PATIENT INFORMATION', margin + 3, y + 5.4);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(30, 41, 59);
      const infoLine = toPdfAscii(infoBits.join('   |   '));
      const wrapped = doc.splitTextToSize(infoLine || 'Not provided', maxWidth - 6);
      doc.text(wrapped.slice(0, 2), margin + 3, y + 10.5);
      y += boxHeight + 5;
    }

    // Urgency flags — only the patient's own words
    const flags = (Array.isArray(entry.urgentFlags) ? entry.urgentFlags : []).filter(Boolean);
    if (flags.length) {
      const flagText = flags.join('  |  ');
      const flagHeight = 24;
      ensureSpace(flagHeight + 6);
      doc.setFillColor(254, 242, 242);
      doc.setDrawColor(220, 38, 38);
      doc.roundedRect(margin, y, maxWidth, flagHeight, 2, 2, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(185, 28, 28);
      doc.text('URGENT WORDS SAID BY THE PATIENT', margin + 3, y + 6);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      const wrappedFlags = doc.splitTextToSize(toPdfAscii(flagText), maxWidth - 6);
      doc.text(wrappedFlags.slice(0, 2), margin + 3, y + 11.5);
      doc.setFont('helvetica', 'bold');
      doc.text('If this is an emergency, call 108.', margin + 3, y + 20);
      doc.setFont('helvetica', 'normal');
      y += flagHeight + 6;
    }

    // One column, English only. The patient's exact words stay in the app.
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 118, 110);
    doc.text('SUMMARY (ENGLISH)', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 41, 59);
    y += 4.5;
    doc.setDrawColor(203, 213, 225);
    doc.line(margin, y, margin + maxWidth, y);
    y += 5;

    SECTIONS.forEach(([key, title]) => {
      const text = sectionValueText(entry.englishSummary?.[key] ?? entry.summary?.[key]);
      const blockHeight = 5.5 + measureBlockHeightMm(text, maxWidth - 2, 10);
      ensureSpace(blockHeight + 4);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(15, 118, 110);
      doc.text(toPdfAscii(title), margin, y);
      doc.setTextColor(30, 41, 59);
      y = drawTextBlock(doc, text, margin, y + 5, maxWidth - 2, { fontSize: 10 });
      y += 4;
    });

    // Follow-up answers
    const answers = (entry.followUpAnswers || []).filter((a) => a && a.answer);
    if (answers.length) {
      ensureSpace(14);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(15, 118, 110);
      doc.text('FOLLOW-UP ANSWERS GIVEN BY THE PATIENT', margin, y);
      y += 5;
      doc.setTextColor(30, 41, 59);
      const answerText = answers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join('\n');
      y = drawTextBlock(doc, answerText, margin, y, maxWidth - 6, { fontSize: 9.5 });
      y += 4;
    }

    // AI-suggested symptoms, clearly separated from the patient's own words.
    const possible = (Array.isArray(entry.possibleSymptoms) ? entry.possibleSymptoms : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 6);
    if (possible.length) {
      ensureSpace(20);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(15, 118, 110);
      doc.text('POSSIBLE SYMPTOMS TO ASK ABOUT (AI SUGGESTIONS)', margin, y);
      y += 4.5;
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text('Not the patient\'s words and not a diagnosis. Confirm with the patient.', margin, y);
      y += 5;
      doc.setTextColor(30, 41, 59);
      y = drawTextBlock(doc, possible.map((item) => `- ${item}`).join('\n'), margin, y, maxWidth - 2, {
        fontSize: 9.5
      });
      y += 4;
    }

    // Disclaimer
    ensureSpace(20);
    doc.setFillColor(240, 253, 250);
    doc.setDrawColor(13, 148, 136);
    doc.roundedRect(margin, y, maxWidth, 16, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 118, 110);
    doc.text('HEALTHCARE COMMUNICATION DISCLAIMER', margin + 3, y + 5.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(51, 65, 85);
    doc.text(
      doc.splitTextToSize(
        'This summary was generated from the patient\'s own description to help doctor communication. It is NOT a medical diagnosis, prescription, or verified medical record. Urgency words are repeated exactly as the patient said them; VoiceCare does not judge severity.',
        maxWidth - 6
      ),
      margin + 3,
      y + 10
    );

    return doc;
  }

  async function downloadPdf(entry) {
    const doc = createPdfDocument(entry);
    const fileName = `VoiceCare-Summary-${new Date().toISOString().slice(0, 10)}.pdf`;

    if (!doc) {
      window.print();
      return { method: 'print' };
    }

    const cap = window.Capacitor;
    const plugins = cap && cap.Plugins ? cap.Plugins : {};
    if (cap && cap.isNativePlatform && cap.isNativePlatform() && plugins.Filesystem) {
      const dataUri = doc.output('datauristring');
      const base64Data = dataUri.split(',')[1];
      const saved = await plugins.Filesystem.writeFile({
        path: fileName,
        data: base64Data,
        directory: 'DOCUMENTS'
      });
      return { method: 'capacitor-filesystem', uri: saved.uri, fileName };
    }

    doc.save(fileName);
    return { method: 'browser-download', fileName };
  }

  async function shareWithDoctor(entry) {
    const textSummary = formatPlainTextSummary(entry);
    const doc = createPdfDocument(entry);
    const fileName = `VoiceCare-Summary-${new Date().toISOString().slice(0, 10)}.pdf`;

    const cap = window.Capacitor;
    const plugins = cap && cap.Plugins ? cap.Plugins : {};

    if (cap && cap.isNativePlatform && cap.isNativePlatform() && plugins.Share && plugins.Filesystem && doc) {
      const dataUri = doc.output('datauristring');
      const base64Data = dataUri.split(',')[1];
      const saved = await plugins.Filesystem.writeFile({
        path: fileName,
        data: base64Data,
        directory: 'CACHE'
      });
      await plugins.Share.share({
        title: 'VoiceCare Patient Summary',
        text: textSummary,
        url: saved.uri,
        dialogTitle: 'Share summary with your doctor'
      });
      return { method: 'capacitor-share' };
    }

    if (navigator.share) {
      if (doc && navigator.canShare) {
        const blob = doc.output('blob');
        const file = new File([blob], fileName, { type: 'application/pdf' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: 'VoiceCare Patient Summary',
            text: 'Patient summary prepared with VoiceCare.',
            files: [file]
          });
          return { method: 'web-share-file' };
        }
      }
      await navigator.share({ title: 'VoiceCare Patient Summary', text: textSummary });
      return { method: 'web-share-text' };
    }

    await copyTextSafe(textSummary);
    return { method: 'clipboard-fallback' };
  }

  async function copyTextSafe(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // fall through to the legacy path
      }
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (!ok) throw new Error('Clipboard unavailable');
    return true;
  }

  return {
    formatPlainTextSummary,
    copyTextSafe,
    downloadPdf,
    shareWithDoctor,
    patientLine,
    hasNativeScript
  };
})();
