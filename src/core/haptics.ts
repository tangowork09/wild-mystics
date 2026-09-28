// Haptic feedback: Capacitor Haptics on native builds, Vibration API on the web.
import { settings } from './settings';

type Style = 'light' | 'medium' | 'heavy' | 'success';
interface CapHaptics { impact(o: { style: string }): Promise<void>; notification(o: { type: string }): Promise<void> }

let native: CapHaptics | null = null;
/** Called by the native bootstrap once @capacitor/haptics is loaded. */
export function setNativeHaptics(h: CapHaptics) { native = h; }
function cap(): CapHaptics | null {
  if (native) return native;
  const w = window as unknown as { Capacitor?: { Plugins?: { Haptics?: CapHaptics } } };
  return w.Capacitor?.Plugins?.Haptics ?? null;
}

export function haptic(style: Style = 'light') {
  if (!settings.haptics) return;
  try {
    const h = cap();
    if (h) {
      if (style === 'success') void h.notification({ type: 'SUCCESS' });
      else void h.impact({ style: style.toUpperCase() });
      return;
    }
    navigator.vibrate?.(style === 'heavy' ? 45 : style === 'medium' ? 25 : style === 'success' ? [20, 40, 30] : 12);
  } catch { /* unsupported */ }
}
