import { db } from './firebase';
import {
  collection, doc, getDocs, getDoc, addDoc, deleteDoc, setDoc, updateDoc,
  query, orderBy
} from 'firebase/firestore';

// ---------- Scholarships ----------
export async function getScholarships() {
  const q = query(collection(db, 'scholarships'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addScholarship(scholarship) {
  await addDoc(collection(db, 'scholarships'), {
    ...scholarship,
    createdAt: Date.now()
  });
}

export async function deleteScholarship(id) {
  await deleteDoc(doc(db, 'scholarships', id));
}

// ---------- Applications ----------
export async function getApplications() {
  const q = query(collection(db, 'applications'), orderBy('submittedAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addApplication(application) {
  const ref = await addDoc(collection(db, 'applications'), {
    ...application,
    submittedAt: Date.now()
  });
  return ref.id;
}

export async function updateApplicationStatus(id, paymentStatus) {
  await updateDoc(doc(db, 'applications', id), { paymentStatus });
}

// ---------- Settings (single document) ----------
const SETTINGS_DOC = doc(db, 'settings', 'main');

export async function getSettings() {
  const snap = await getDoc(SETTINGS_DOC);
  return snap.exists() ? snap.data() : {
    feeAmount: 0,
    emailjsPublicKey: '',
    emailjsServiceId: '',
    emailjsTemplateId: ''
  };
}

export async function saveSettings(settings) {
  await setDoc(SETTINGS_DOC, settings, { merge: true });
}
