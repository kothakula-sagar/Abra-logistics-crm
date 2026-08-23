/**
 * firebase.js - Firebase initialisation
 * Exposes a single `FB` object used by every other module.
 * Uses the EXISTING project - no data is altered.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore, collection, doc, setDoc, getDoc, getDocs,
  query, where, orderBy, deleteDoc, updateDoc, addDoc,
  serverTimestamp, limit, writeBatch, documentId
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyDTDGJTzXFTGSZyu_O-SSdS3Mis1u0_e0g',
  authDomain:        'abra-zylo-seo.firebaseapp.com',
  projectId:         'abra-zylo-seo',
  storageBucket:     'abra-zylo-seo.firebasestorage.app',
  messagingSenderId: '1079467827029',
  appId:             '1:1079467827029:web:8bd2ff1eb0c7d66ae059dc'
};

const app  = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db   = getFirestore(app);
const storage = getStorage(app);

/** Central Firebase API - import this object everywhere */
export const FB = {
  auth, db, storage,
  // Auth helpers
  createUserWithEmailAndPassword: (e, p) => createUserWithEmailAndPassword(auth, e, p),
  signIn:         (e, p) => signInWithEmailAndPassword(auth, e, p),
  signOut:        ()     => signOut(auth),
  onAuthChanged:  (cb)   => onAuthStateChanged(auth, cb),
  updateProfile:  (u, d) => updateProfile(u, d),
  sendReset:      (e)    => sendPasswordResetEmail(auth, e),
  // Firestore helpers
  col:             (path)    => collection(db, path),
  docRef:          (path, id) => doc(db, path, id),
  setDoc, getDoc, getDocs, updateDoc, deleteDoc, addDoc,
  query, where, orderBy, limit, writeBatch: () => writeBatch(db),
  serverTimestamp, documentId,
  // Storage helpers
  ref:            (path) => ref(storage, path),
  uploadBytes,
  getDownloadURL
};

// Signal readiness for any non-module scripts that may poll
window._fbReady = true;
document.dispatchEvent(new CustomEvent('fbReady'));
