/**
 * VoiceCare PDF Report & Native Sharing Module
 *
 * Uses jsPDF for clean doctor-friendly A4 PDF generation,
 * and Capacitor Filesystem + Share on Android/iOS (with Web Share / download fallback).
 */

window.VOICECARE_PDF = (() => {
  function formatPlainTextSummary(entry) {
    const s = entry.summary;
    const dateStr = new Date(entry.updatedAt || entry.createdAt).toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });

    const lines = [
      'VOICECARE — PATIENT HEALTH SUMMARY',
      `Prepared on: ${dateStr}`,
      entry.patientName ? `Patient: ${entry.patientName}` : null,
      `Preferred Language: ${entry.languageLabel || entry.language || 'English'}`,
      '----------------------------------------',
      `1. Main Health Concern:\n${s.mainHealthConcern}`,
      `\n2. Symptoms:\n${(s.symptoms || []).map((x) => `• ${x}`).join('\n')}`,
      `\n3. Duration:\n${s.duration}`,
      `\n4. Severity:\n${s.severity}`,
      `\n5. Relevant Medical History:\n${s.relevantMedicalHistory}`,
      `\n6. Current Medications:\n${s.currentMedications}`,
      `\n7. Additional Observations:\n${s.additionalObservations}`,
      `\n8. Questions to Ask the Doctor:\n${(s.questionsToAskDoctor || []).map((x, i) => `${i + 1}. ${x}`).join('\n')}`,
      '----------------------------------------',
      'IMPORTANT NOTICE: Prepared by the patient with VoiceCare AI to support doctor consultation. Not a medical diagnosis or prescription.'
    ].filter(Boolean);

    return lines.join('\n');
  }

  function createPdfDocument(entry) {
    const jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDFCtor) {
      return null;
    }

    const doc = new jsPDFCtor({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 16;
    const maxWidth = pageWidth - margin * 2;
    let y = 18;

    const ensureSpace = (needed = 16) => {
      if (y + needed > 276) {
        doc.addPage();
        y = 18;
      }
    };

    // Teal header bar
    doc.setFillColor(15, 118, 110);
    doc.rect(0, 0, pageWidth, 28, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('VoiceCare — Patient Health Summary', margin, 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('Speak naturally. Let AI organise. Help your doctor understand.', margin, 21);

    y = 38;
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(10);
    const dateStr = new Date(entry.updatedAt || entry.createdAt).toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
    doc.text(`Prepared: ${dateStr}`, margin, y);
    if (entry.patientName) {
      doc.text(`Patient: ${entry.patientName}`, pageWidth - margin, y, { align: 'right' });
    }
    y += 6;
    doc.text(`Input Language: ${entry.languageLabel || 'English'}`, margin, y);
    y += 4;
    doc.setDrawColor(203, 213, 225);
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;

    // Emergency notice banner if flagged
    if (entry.metadata?.emergencyWarning?.detected) {
      ensureSpace(22);
      doc.setFillColor(254, 242, 242);
      doc.setDrawColor(220, 38, 38);
      doc.roundedRect(margin, y, maxWidth, 18, 2, 2, 'FD');
      doc.setTextColor(185, 28, 28);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text('URGENT CARE GUIDANCE', margin + 4, y + 6);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      const warnLines = doc.splitTextToSize(
        entry.metadata.emergencyWarning.guidance,
        maxWidth - 8
      );
      doc.text(warnLines.slice(0, 2), margin + 4, y + 11);
      y += 24;
    }

    const s = entry.summary;
    const sections = [
      ['1. Main Health Concern', s.mainHealthConcern],
      ['2. Symptoms', (s.symptoms || []).map((item) => `• ${item}`).join('\n')],
      ['3. Duration', s.duration],
      ['4. Severity', s.severity],
      ['5. Relevant Medical History', s.relevantMedicalHistory],
      ['6. Current Medications', s.currentMedications],
      ['7. Additional Observations', s.additionalObservations],
      [
        '8. Questions to Ask the Doctor',
        (s.questionsToAskDoctor || []).map((q, idx) => `${idx + 1}. ${q}`).join('\n')
      ]
    ];

    for (const [title, body] of sections) {
      const contentText = body && String(body).trim() ? String(body) : 'Not mentioned by patient';
      const wrapped = doc.splitTextToSize(contentText, maxWidth - 6);
      const blockHeight = 9 + wrapped.length * 5.2;
      ensureSpace(blockHeight + 4);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(15, 118, 110);
      doc.text(title, margin, y);
      y += 5.5;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10.5);
      doc.setTextColor(30, 41, 59);
      doc.text(wrapped, margin + 2, y);
      y += wrapped.length * 5.2 + 5;
    }

    // Disclaimer box at bottom
    ensureSpace(22);
    y += 2;
    doc.setFillColor(240, 253, 250);
    doc.setDrawColor(13, 148, 136);
    doc.roundedRect(margin, y, maxWidth, 18, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 118, 110);
    doc.text('HEALTHCARE COMMUNICATION DISCLAIMER', margin + 4, y + 6);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 65, 85);
    const discLines = doc.splitTextToSize(
      'This summary is generated from the patient’s own description to assist doctor communication. It is NOT a medical diagnosis, prescription, or verified medical record.',
      maxWidth - 8
    );
    doc.text(discLines, margin + 4, y + 11);

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

    // Native Android / iOS Capacitor Share with PDF attachment
    if (
      cap &&
      cap.isNativePlatform &&
      cap.isNativePlatform() &&
      plugins.Share &&
      plugins.Filesystem &&
      doc
    ) {
      const dataUri = doc.output('datauristring');
      const base64Data = dataUri.split(',')[1];
      const saved = await plugins.Filesystem.writeFile({
        path: fileName,
        data: base64Data,
        directory: 'CACHE'
      });

      await plugins.Share.share({
        title: 'VoiceCare Patient Health Summary',
        text: textSummary,
        url: saved.uri,
        dialogTitle: 'Share Health Summary with Your Doctor'
      });
      return { method: 'capacitor-share' };
    }

    // Modern Web Share API (works on mobile Chrome / Android WebView / desktop Safari/Edge)
    if (navigator.share) {
      if (doc && navigator.canShare) {
        const blob = doc.output('blob');
        const file = new File([blob], fileName, { type: 'application/pdf' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: 'VoiceCare Patient Health Summary',
            text: 'Patient health summary prepared with VoiceCare.',
            files: [file]
          });
          return { method: 'web-share-file' };
        }
      }
      await navigator.share({
        title: 'VoiceCare Patient Health Summary',
        text: textSummary
      });
      return { method: 'web-share-text' };
    }

    // Fallback: copy to clipboard
    await navigator.clipboard.writeText(textSummary);
    return { method: 'clipboard-fallback' };
  }

  return {
    formatPlainTextSummary,
    downloadPdf,
    shareWithDoctor
  };
})();
