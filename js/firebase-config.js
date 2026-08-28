// ============================================================
// FIREBASE CONFIGURATION
// ============================================================
// 1. Go to https://console.firebase.google.com
// 2. Create a project (or use an existing Abra Group project)
// 3. Enable: Authentication > Sign-in method > Email/Password
// 4. Enable: Firestore Database (start in production mode)
// 5. Project settings > General > Your apps > Web app > copy config below
// 6. Enable: Firebase Storage for call recordings
// ============================================================

(function() {
  'use strict';
  
  const firebaseConfig = {
    apiKey: "AIzaSyDVOShmPyTevg2dn26YGZc4NzPHOP8_III",
    authDomain: "crm-leads-manager-236be.firebaseapp.com",
    projectId: "crm-leads-manager-236be",
    messagingSenderId: "732928013180",
    appId: "1:732928013180:web:d7d568f4fac1444e35eaf9"
  };

  window.firebaseConfig = firebaseConfig;

  // Initialize Firebase
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  // Initialize services with error handling
  let auth, db;
  let firestoreAvailable = false;
  let authAvailable = false;

  try {
    auth = firebase.auth();
    authAvailable = true;
    console.log('Firebase Auth initialized');
  } catch (err) {
    console.error('Firebase Auth initialization error:', err);
  }

  try {
    db = firebase.firestore();
    firestoreAvailable = true;
    console.log('Firebase Firestore initialized');
  } catch (err) {
    console.error('Firebase Firestore initialization error:', err);
  }

  // Export services globally
  window.auth = auth;
  window.db = db;

  // Collection references
  const usersRef = firestoreAvailable ? db.collection("users") : null;
  const leadsRef = firestoreAvailable ? db.collection("leads") : null;
  const metaRef = firestoreAvailable ? db.collection("meta") : null;
  const callAuditsRef = firestoreAvailable ? db.collection("callAudits") : null;
  const notificationsRef = firestoreAvailable ? db.collection("notifications") : null;
  const assignmentQueueRef = firestoreAvailable ? db.collection("assignmentQueue") : null;
  const leavesRef = firestoreAvailable ? db.collection("leaves") : null;
  const trainingCategoriesRef = firestoreAvailable ? db.collection("trainingCategories") : null;
  const trainingsRef = firestoreAvailable ? db.collection("trainings") : null;
  const trainingProgressRef = firestoreAvailable ? db.collection("trainingProgress") : null;
  const certificatesRef = firestoreAvailable ? db.collection("certificates") : null;
  const knowledgeBaseRef = firestoreAvailable ? db.collection("knowledgeBase") : null;
  const quizzesRef = firestoreAvailable ? db.collection("quizzes") : null;
  const marketingContactsRef = firestoreAvailable ? db.collection("marketingContacts") : null;
  const emailMarketingCampaignsRef = firestoreAvailable ? db.collection("emailMarketingCampaigns") : null;
  const whatsappMarketingCampaignsRef = firestoreAvailable ? db.collection("whatsappMarketingCampaigns") : null;

  // Export all references globally
  window.usersRef = usersRef;
  window.leadsRef = leadsRef;
  window.metaRef = metaRef;
  window.callAuditsRef = callAuditsRef;
  window.notificationsRef = notificationsRef;
  window.assignmentQueueRef = assignmentQueueRef;
  window.leavesRef = leavesRef;
  window.trainingCategoriesRef = trainingCategoriesRef;
  window.trainingsRef = trainingsRef;
  window.trainingProgressRef = trainingProgressRef;
  window.certificatesRef = certificatesRef;
  window.knowledgeBaseRef = knowledgeBaseRef;
  window.quizzesRef = quizzesRef;
  window.marketingContactsRef = marketingContactsRef;
  window.emailMarketingCampaignsRef = emailMarketingCampaignsRef;
  window.whatsappMarketingCampaignsRef = whatsappMarketingCampaignsRef;

  // Utility functions for checking service availability
  window.isFirestoreAvailable = function() { return firestoreAvailable; };
  window.isAuthAvailable = function() { return authAvailable; };
})();
