import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

// 1. Go to https://console.firebase.google.com -> Create a project (free).
// 2. Inside the project: Build -> Firestore Database -> Create database (start in test mode for now).
// 3. Project settings (gear icon) -> scroll to "Your apps" -> Add app -> Web (</>) -> register it.
// 4. Copy the firebaseConfig object it gives you and paste the values below.
const firebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "PASTE_YOUR_PROJECT.firebaseapp.com",
  projectId: "PASTE_YOUR_PROJECT_ID",
  storageBucket: "PASTE_YOUR_PROJECT.appspot.com",
  messagingSenderId: "PASTE_YOUR_SENDER_ID",
  appId: "PASTE_YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
