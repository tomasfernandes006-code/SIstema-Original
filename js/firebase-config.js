// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { getMessaging } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging.js";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCguKS7OEZAxMXknZwNgBBUi28q6hL1ttg",
  authDomain: "sistema-original.firebaseapp.com",
  projectId: "sistema-original",
  storageBucket: "sistema-original.firebasestorage.app",
  messagingSenderId: "772648678837",
  appId: "1:772648678837:web:d024aa65fb67c573df15fc",
  measurementId: "G-FR6C45EWQK"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Instância do Firestore exportada para ser usada nos outros arquivos:
//   import { db } from "./firebase-config.js";
const db = getFirestore(app);

// Instância do Messaging (notificações push). Fica em try/catch porque
// getMessaging pode não ser suportado em ambientes sem service worker
// (ex.: página aberta por file://), e isso não pode derrubar o resto.
//   import { messaging } from "./firebase-config.js";
let messaging = null;
try {
  messaging = getMessaging(app);
} catch {
  messaging = null;
}

export { app, db, messaging };
