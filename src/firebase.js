import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDwiMdQB1UO3qTECl-4hxEPCYqKBg9KoBw",
  authDomain: "vidhya-nidhi.firebaseapp.com",
  projectId: "vidhya-nidhi",
  storageBucket: "vidhya-nidhi.firebasestorage.app",
  messagingSenderId: "232937311476",
  appId: "1:232937311476:web:e496fe1a238b5f6075a2a1"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
