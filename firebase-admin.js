// ============================================================
//  SKYWIND ADMIN – firebase-admin.js
//  Shared Firebase init + Auth + DB helpers used by all pages
//  Replace the placeholder values with your Firebase credentials
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  push,
  set,
  get,
  remove,
  query,
  orderByChild,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

// ── Firebase project config ────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDs84WMvaBXNSpBR6q9sawhUupiJAydatQ",
  authDomain: "skywind-24814.firebaseapp.com",
  databaseURL: "https://skywind-24814-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "skywind-24814",
  storageBucket: "skywind-24814.firebasestorage.app",
  messagingSenderId: "480721783076",
  appId: "1:480721783076:web:d0072b88309a9376118bb1",
  measurementId: "G-VWGT1FD4WK"
};

const app       = initializeApp(firebaseConfig);
export const auth = getAuth(app);
const db          = getDatabase(app);

// ── DB path constants ──────────────────────────────────────
export const PATHS = {
  users:     "users",      // admin accounts  (uid → profile)
  bookings:  "bookings",   // pending booking requests from userside
  schedules: "schedules",  // accepted / scheduled appointments
};

// ── Auth helpers ───────────────────────────────────────────

/** Register a new admin account and store profile in /users */
export async function registerAdmin({ name, email, password, address, contact }) {
  // Firebase Auth: create the account
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const uid  = cred.user.uid;

  // Store extra profile fields in Realtime DB
  await set(ref(db, `${PATHS.users}/${uid}`), {
    name,
    email,
    address,
    contact,
    created_at: new Date().toISOString(),
    role: "admin",
  });

  return cred.user;
}

/** Sign in an existing admin */
export async function loginAdmin(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

/** Sign out */
export async function logoutAdmin() {
  await signOut(auth);
}

/** Returns the currently signed-in user, or null */
export function getCurrentUser() {
  return auth.currentUser;
}

/**
 * Guard helper — call on every protected page.
 * Redirects to main.html if no user is logged in.
 * Calls onReady(user, profile) once auth state is confirmed.
 */
export function requireAuth(onReady) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "main.html";
      return;
    }
    // Fetch profile from DB
    const snap    = await get(ref(db, `${PATHS.users}/${user.uid}`));
    const profile = snap.exists() ? snap.val() : { name: user.email, email: user.email };
    onReady(user, profile);
  });
}

// ── Booking / Request helpers ──────────────────────────────

/** Fetch all pending booking requests (from /bookings) */
export async function fetchRequests() {
  const snap = await get(
    query(ref(db, PATHS.bookings), orderByChild("date_time"))
  );
  const results = [];
  if (snap.exists()) {
    snap.forEach((child) => {
      results.push({ ...child.val(), _key: child.key });
    });
  }
  return results.reverse(); // newest first
}

/** Move a booking from /bookings to /schedules (accept action) */
export async function acceptRequest(bookingKey, bookingData) {
  // Strip _key so the booking's old key is never saved inside the schedule record
  const { _key, ...cleanData } = bookingData;

  // Write to /schedules
  const schedKey = push(ref(db, PATHS.schedules)).key;
  await set(ref(db, `${PATHS.schedules}/${schedKey}`), {
    ...cleanData,
    accepted_at: new Date().toISOString(),
    status: "scheduled",
  });
  // Remove from /bookings
  await remove(ref(db, `${PATHS.bookings}/${bookingKey}`));
}

/** Delete a booking request (reject action) */
export async function rejectRequest(bookingKey) {
  await remove(ref(db, `${PATHS.bookings}/${bookingKey}`));
}

// ── Schedule helpers ───────────────────────────────────────

/** Fetch all scheduled (accepted) appointments */
export async function fetchSchedules() {
  const snap = await get(
    query(ref(db, PATHS.schedules), orderByChild("date_time"))
  );
  const results = [];
  if (snap.exists()) {
    snap.forEach((child) => {
      // _key must come AFTER the spread so it overrides any stale _key stored in the data
      results.push({ ...child.val(), _key: child.key });
    });
  }
  return results.reverse();
}

/** Mark a scheduled appointment as complete (delete it) */
export async function completeSchedule(scheduleKey) {
  await remove(ref(db, `${PATHS.schedules}/${scheduleKey}`));
}

// ── SMS helper (unchanged from original) ──────────────────
/**
 * Sends an SMS via iProgSMS API.
 * NOTE: Direct browser-to-API calls may be blocked by CORS.
 * If that happens, deploy a small Firebase Cloud Function as a proxy.
 */
export async function sendSMS(contact, name, service, dateTime) {
  const API_URL   = "https://www.iprogsms.com/api/v1/sms_messages";
  const API_TOKEN = "328597cd7ac503e191434f418d6e4ea35c541cbc"; // keep your token here

  // Format date the same way the original PHP did
  const dt      = new Date(dateTime.replace(" ", "T"));
  const options = { month: "2-digit", day: "2-digit", year: "numeric",
                    hour:  "numeric",  minute: "2-digit", hour12: true };
  const formattedDate = dt.toLocaleString("en-US", options).replace(",", " -");

  const message =
    `Hi ${name}! This is Skywind Airconditioning Services\n\n` +
    `Your appointment has been accepted!\n` +
    `Service: ${service}\n` +
    `Date: ${formattedDate}\n\n` +
    `For your concerns, please contact us at 0926-905-5430 or in our Facebook page.`;

  const body = new URLSearchParams({ api_token: API_TOKEN, message, phone_number: contact });

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    return { success: res.ok, response: await res.text() };
  } catch (err) {
    return { success: false, error: err.message };
  }
}