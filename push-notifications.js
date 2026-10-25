import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { arrayUnion, doc, getFirestore, setDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { getMessaging, getToken, isSupported } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-messaging.js";

const firebaseConfig = {
  apiKey: "AIzaSyBFadmAn_msK29B3Hj-NyXs3dNiMPEH5eE",
  authDomain: "conecta-f0162.firebaseapp.com",
  projectId: "conecta-f0162",
  storageBucket: "conecta-f0162.firebasestorage.app",
  messagingSenderId: "483948542084",
  appId: "1:483948542084:web:ac512a6e91c87a5ea0ead1",
  measurementId: "G-99SX22B1DC",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
let pushToken = "";
let messagingPromise;

async function getPushToken() {
  if (!window.isSecureContext || !("serviceWorker" in navigator) || !("Notification" in window)) {
    throw new Error("Este navegador no admite notificaciones push en este contexto.");
  }
  if (Notification.permission !== "granted") {
    throw new Error("Primero debes conceder el permiso de notificaciones.");
  }
  if (!(await isSupported())) throw new Error("Firebase Messaging no es compatible con este navegador.");

  const registration = await navigator.serviceWorker.ready;
  messagingPromise ||= Promise.resolve(getMessaging(app));
  const messaging = await messagingPromise;
  const token = await getToken(messaging, { serviceWorkerRegistration: registration });
  if (!token) throw new Error("Firebase no pudo crear el token push para este dispositivo.");
  pushToken = token;
  return token;
}

async function saveTokenForUser(user, token = pushToken) {
  if (!user || !token) return false;
  await setDoc(doc(db, "users", user.uid), {
    pushTokens: arrayUnion(token),
  }, { merge: true });
  return true;
}

window.enablePushNotifications = async () => {
  try {
    const token = await getPushToken();
    if (auth.currentUser) {
      await saveTokenForUser(auth.currentUser, token);
      return { ok: true };
    }
    return {
      ok: false,
      message: "Permiso concedido. Inicia sesión para vincular este dispositivo a tu cuenta y recibir notificaciones.",
    };
  } catch (error) {
    console.warn("No se pudo preparar el dispositivo para push:", error);
    return { ok: false, message: error.message || "No se pudo activar el servicio push." };
  }
};

onAuthStateChanged(auth, async (user) => {
  if (!user || !("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const token = await getPushToken();
    await saveTokenForUser(user, token);
  } catch (error) {
    console.warn("No se pudo sincronizar el token push de este usuario:", error);
  }
});
