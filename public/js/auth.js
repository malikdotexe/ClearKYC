import {
  auth,
  db,
  googleProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
} from "./firebase-config.js";

let currentUser = null;

export function getCurrentUser() {
  return currentUser;
}

export function initAuth(onLogin, onLogout) {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      await ensureUserDoc(user);
      onLogin(user);
    } else {
      currentUser = null;
      onLogout();
    }
  });
}

async function ensureUserDoc(user) {
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) {
    await setDoc(userRef, {
      displayName: user.displayName,
      email: user.email,
      photoURL: user.photoURL,
      kycCompletion: 0,
      totalEarnings: 0,
      createdAt: serverTimestamp(),
    });
  }
}

export async function signInWithGoogle() {
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    if (err.code === "auth/popup-closed-by-user") return;
    throw err;
  }
}

export async function signOut() {
  await firebaseSignOut(auth);
}
