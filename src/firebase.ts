import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, RecaptchaVerifier, PhoneAuthProvider, linkWithCredential, deleteUser } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import firebaseConfig from '../firebase-applet-config.json';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// ignoreUndefinedProperties: campos `undefined` são descartados em vez de
// derrubar a escrita inteira. Slides gerados pela IA quase sempre têm campos
// opcionais indefinidos (imageUrl, subtitle, topics…) — sem isso, salvar o deck
// no Acervo falhava sempre com o erro genérico "A internet cochilou".
export const db = initializeFirestore(app, { ignoreUndefinedProperties: true }, firebaseConfig.firestoreDatabaseId);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

export const signIn = () => signInWithPopup(auth, googleProvider);
export const logOut = () => signOut(auth);
export { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, RecaptchaVerifier, PhoneAuthProvider, linkWithCredential, deleteUser };

// ── Push notifications (FCM) ───────────────────────────────────────────────
// Retorna o token FCM do dispositivo, ou null se não suportado/sem chave VAPID.
export async function getFcmToken(swRegistration: ServiceWorkerRegistration): Promise<string | null> {
  try {
    const vapidKey = (firebaseConfig as { vapidKey?: string }).vapidKey;
    if (!vapidKey) return null;
    if (!(await isSupported())) return null;
    const messaging = getMessaging(app);
    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: swRegistration });
    return token || null;
  } catch (e) {
    console.error('Erro ao obter token FCM:', e);
    return null;
  }
}
