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
    const plugin = getLocalNotificationsPlugin();
    if (plugin) {
      const result = await plugin.requestPermissions();
      return result.display === 'granted';
    }
    if ('Notification' in window) {
      if (Notification.permission === 'granted') return true;
      const perm = await Notification.requestPermission();
      return perm === 'granted';
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

  async function scheduleReminder(reminder) {
    const [hourStr, minuteStr] = (reminder.time || '08:00').split(':');
    const hour = Number(hourStr) || 8;
    const minute = Number(minuteStr) || 0;
    const notifId = numericIdFromString(reminder.id);

    const plugin = getLocalNotificationsPlugin();
    if (plugin) {
      await requestPermission();
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
      await requestPermission();
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

  return {
    requestPermission,
    scheduleReminder,
    cancelReminder,
    sendTestNotification
  };
})();
