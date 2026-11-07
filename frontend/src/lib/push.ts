import { api } from './api';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window;

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function register(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration('/')) ?? (await navigator.serviceWorker.register('/sw.js'));
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await register();
  return reg.pushManager.getSubscription();
}

export async function enablePush(): Promise<'subscribed' | 'denied' | 'unsupported' | 'unconfigured'> {
  if (!pushSupported()) return 'unsupported';
  const { key } = await api.get<{ key: string | null }>('/push/vapid-public-key');
  if (!key) return 'unconfigured';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  const reg = await register();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
  }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api.post('/push/subscribe', { endpoint: json.endpoint, keys: json.keys });
  return 'subscribed';
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.del('/push/subscribe', { endpoint: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe();
}
