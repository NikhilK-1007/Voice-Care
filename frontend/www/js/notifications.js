/**
 * VoiceCare Medicine Reminder Notifications
 *
 * Uses Capacitor LocalNotifications on Android/iOS,
 * and falls back to Web Notification API + in-app reminder banner on desktop/mobile web.
 */

window.VOICECARE_NOTIFICATIONS = (() => {
  function getLocalNotificationsPlugin() {
    const cap = window.Capacitor;
    if (cap && cap.isNativePlatform && cap.isNativePlatform()) {
      return cap.Plugins?.LocalNotifications || null;
    }
    return null;
  }

  async function requestPermission() {
    try {
      const plugin = getLocalNotificationsPlugin();
      if (plugin) {
        const result = await plugin.requestPermissions();
        return result?.display === 'granted';
      }
      if ('Notification' in window) {
        if (Notification.permission === 'granted') return true;
        if (Notification.permission === 'denied') return false;
        const perm = await Notification.requestPermission();
        return perm === 'granted';
      }
    } catch (err) {
      console.warn('[VoiceCare Notifications] Permission request failed:', err?.message || err);
    }
    return false;
  }

  function numericIdFromString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i += 1) {
      hash = (hash * 31 + str.charCodeAt(i)) % 2147483000;
    }
    return Math.abs(hash) + 1;
  }

  function parseHourMinute(timeStr) {
    const [hourStr, minuteStr] = String(timeStr || '08:00').split(':');
    const parsedHour = Number.parseInt(hourStr, 10);
    const parsedMinute = Number.parseInt(minuteStr, 10);
    return {
      hour: Number.isInteger(parsedHour) && parsedHour >= 0 && parsedHour <= 23 ? parsedHour : 8,
      minute: Number.isInteger(parsedMinute) && parsedMinute >= 0 && parsedMinute <= 59 ? parsedMinute : 0
    };
  }

  async function scheduleReminder(reminder) {
    const { hour, minute } = parseHourMinute(reminder.time);
    const notifId = numericIdFromString(reminder.id);

    const plugin = getLocalNotificationsPlugin();
    if (plugin) {
      try {
        const granted = await requestPermission();
        if (!granted) {
          return { platform: 'capacitor', scheduled: false, reason: 'permission-denied' };
        }
        await plugin.schedule({
          notifications: [
            {
              id: notifId,
              title: `Medicine Reminder: ${reminder.name}`,
              body: `${reminder.dosageNote || 'Take as prescribed by your doctor'} (${reminder.timingTag || 'Daily'})`,
              schedule: {
                on: { hour, minute },
                repeats: true,
                allowWhileIdle: true
              }
            }
          ]
        });
        return { platform: 'capacitor', scheduled: true };
      } catch (err) {
        console.warn('[VoiceCare Notifications] Schedule failed:', err?.message || err);
        return { platform: 'capacitor', scheduled: false, reason: 'schedule-error' };
      }
    }

    return { platform: 'web', scheduled: true };
  }

  async function cancelReminder(reminderId) {
    const plugin = getLocalNotificationsPlugin();
    if (plugin) {
      try {
        await plugin.cancel({
          notifications: [{ id: numericIdFromString(reminderId) }]
        });
      } catch (err) {
        console.warn('[VoiceCare Notifications] Cancel warning:', err);
      }
    }
  }

  async function sendTestNotification(reminder) {
    const title = `Medicine Reminder: ${reminder.name}`;
    const body = `${reminder.dosageNote || 'Remember to take your medicine'} • ${reminder.timingTag || ''}`;

    const plugin = getLocalNotificationsPlugin();
    if (plugin) {
      try {
        const granted = await requestPermission();
        if (!granted) return false;
        await plugin.schedule({
          notifications: [
            {
              id: Math.floor(Math.random() * 100000) + 1000,
              title,
              body,
              schedule: { at: new Date(Date.now() + 1500) }
            }
          ]
        });
        return true;
      } catch (err) {
        console.warn('[VoiceCare Notifications] Test alert failed:', err?.message || err);
        return false;
      }
    }

    if ('Notification' in window) {
      const granted = await requestPermission();
      if (granted) {
        new Notification(title, { body });
        return true;
      }
    }
    return false;
  }

  async function scheduleAllReminders(reminders = []) {
    if (!Array.isArray(reminders) || !reminders.length) return;
    const plugin = getLocalNotificationsPlugin();
    if (!plugin) return;
    for (const rem of reminders) {
      if (rem && rem.active !== false) {
        await scheduleReminder(rem);
      }
    }
  }

  return {
    requestPermission,
    scheduleReminder,
    scheduleAllReminders,
    cancelReminder,
    sendTestNotification
  };
})();
