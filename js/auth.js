// ============================================================
// AUTH.JS — Login, logout, forgot password
// ============================================================
//
// Only users with a matching document in the "users" collection
// (created/provisioned by Super Admin) are allowed into the CRM.
//
// Firebase Authentication handles:
// - Email/password login
// - Password reset
// - Logout
//
// Firestore handles:
// - CRM user profile
// - Role
// - Active/inactive status
// ============================================================


// ============================================================
// ERROR UI HELPERS
// ============================================================

function showError(elId, msg) {
  const el = document.getElementById(elId);

  if (el) {
    el.textContent = msg;
    el.classList.remove("d-none");
  }
}


function hideError(elId) {
  const el = document.getElementById(elId);

  if (el) {
    el.classList.add("d-none");
  }
}


function resetLoginBtn() {
  const btn = document.getElementById("loginBtn");

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = "Sign In";
  }
}


// ============================================================
// LOGIN
// ============================================================

(function () {

  const loginForm = document.getElementById("loginForm");

  if (!loginForm) {
    return;
  }


  loginForm.addEventListener("submit", async (e) => {

    e.preventDefault();

    hideError("loginError");


    // ----------------------------------------------------------
    // GET FORM ELEMENTS
    // ----------------------------------------------------------

    const emailEl = document.getElementById("loginEmail");
    const passwordEl = document.getElementById("loginPassword");
    const btn = document.getElementById("loginBtn");


    if (!emailEl || !passwordEl || !btn) {
      console.error("Login form elements not found.");
      return;
    }


    // ----------------------------------------------------------
    // GET VALUES
    // ----------------------------------------------------------

    const email = emailEl.value.trim();
    const password = passwordEl.value;


    // ----------------------------------------------------------
    // CLIENT-SIDE VALIDATION
    // ----------------------------------------------------------

    if (!email || !email.includes("@")) {

      showError(
        "loginError",
        "Please enter a valid email address."
      );

      return;
    }


    if (!password || password.length === 0) {

      showError(
        "loginError",
        "Please enter your password."
      );

      return;
    }


    // ----------------------------------------------------------
    // SHOW LOADING STATE
    // ----------------------------------------------------------

    btn.disabled = true;

    btn.innerHTML =
      '<span class="spinner-border spinner-border-sm me-2"></span>Signing in...';


    // ----------------------------------------------------------
    // CHECK FIREBASE SERVICES
    // ----------------------------------------------------------

    if (
      typeof window.isAuthAvailable !== "function"
      || !window.isAuthAvailable()
    ) {

      showError(
        "loginError",
        "Authentication service is temporarily unavailable. Please refresh the page."
      );

      resetLoginBtn();

      return;
    }


    if (!window.usersRef) {

      showError(
        "loginError",
        "Database connection error. Please refresh the page."
      );

      resetLoginBtn();

      return;
    }


    // ----------------------------------------------------------
    // LOGIN
    // ----------------------------------------------------------

    try {

      console.log("Starting Firebase authentication...");


      const cred =
        await window.auth.signInWithEmailAndPassword(
          email,
          password
        );


      if (!cred || !cred.user) {

        throw new Error(
          "Firebase authentication did not return a user."
        );
      }


      const uid = cred.user.uid;


      console.log(
        "Firebase authentication successful. UID:",
        uid
      );


      // --------------------------------------------------------
      // CHECK CRM USER DOCUMENT
      // --------------------------------------------------------
      //
      // The Firebase Auth account alone is NOT enough.
      //
      // The user must also have:
      //
      // /users/{uid}
      //
      // created/provisioned by Super Admin.
      //
      // Firestore rules allow the authenticated user to GET
      // their own document.
      // --------------------------------------------------------

      const userDoc =
        await window.usersRef.doc(uid).get();


      if (!userDoc.exists) {

        console.warn(
          "Authenticated user does not have a CRM profile:",
          uid
        );


        await window.auth.signOut();


        showError(
          "loginError",
          "This account is not authorized for the CRM. Contact your Super Admin."
        );


        resetLoginBtn();

        return;
      }


      // --------------------------------------------------------
      // GET USER DATA
      // --------------------------------------------------------

      const userData = userDoc.data() || {};


      // --------------------------------------------------------
      // CHECK ACTIVE STATUS
      // --------------------------------------------------------

      if (userData.active === false) {

        console.warn(
          "CRM user account is inactive:",
          uid
        );


        await window.auth.signOut();


        showError(
          "loginError",
          "Your account has been deactivated. Contact your Super Admin."
        );


        resetLoginBtn();

        return;
      }


      // --------------------------------------------------------
      // CHECK ROLE
      // --------------------------------------------------------
      //
      // Existing CRM roles:
      //
      // superadmin
      // admin
      // member
      //
      // Do not hardcode additional roles here.
      // Role-specific permissions are handled by the CRM.
      // --------------------------------------------------------

      if (!userData.role) {

        console.warn(
          "CRM user does not have a role:",
          uid
        );


        await window.auth.signOut();


        showError(
          "loginError",
          "Your CRM account does not have a role assigned. Contact your Super Admin."
        );


        resetLoginBtn();

        return;
      }


      console.log(
        "CRM user verified:",
        {
          uid: uid,
          email: cred.user.email,
          role: userData.role,
          active: userData.active
        }
      );


      // --------------------------------------------------------
      // LOGIN SUCCESS
      // --------------------------------------------------------
      //
      // Firebase Auth keeps the authenticated session.
      // dashboard.html will run requireAuth() and load the
      // user's complete profile again.
      // --------------------------------------------------------

      window.location.href = "dashboard.html";

    } catch (err) {

      console.error(
        "Login error:",
        err
      );


      let msg =
        "Login failed. Please check your email and password.";


      // --------------------------------------------------------
      // FIREBASE AUTH ERROR MESSAGES
      // --------------------------------------------------------

      if (err && err.code) {

        const errorMessages = {

          "auth/user-not-found":
            "Incorrect email or password.",

          "auth/wrong-password":
            "Incorrect email or password.",

          "auth/invalid-credential":
            "Incorrect email or password.",

          "auth/invalid-email":
            "Please enter a valid email address.",

          "auth/too-many-requests":
            "Too many failed attempts. Try again later or reset your password.",

          "auth/network-request-failed":
            "Network error. Check your internet connection and try again.",

          "auth/user-disabled":
            "This account has been disabled. Contact your Super Admin.",

          "auth/operation-not-allowed":
            "Sign-in is temporarily disabled. Contact your administrator.",

          "auth/popup-closed-by-user":
            "Sign-in was cancelled.",

          "auth/cancelled-popup-request":
            "Sign-in was cancelled.",

          "auth/web-storage-unsupported":
            "Browser storage is unavailable. Please enable cookies/storage and try again."
        };


        // IMPORTANT:
        // Do NOT call window.logFirebaseError().
        // That function does not exist in the current project.
        msg =
          errorMessages[err.code]
          || msg;
      }


      // --------------------------------------------------------
      // HANDLE NON-FIREBASE ERRORS
      // --------------------------------------------------------

      else if (err && err.message) {

        if (
          err.message
            .toLowerCase()
            .includes("password")
        ) {

          msg =
            "Please enter a valid password.";
        }
      }


      // --------------------------------------------------------
      // SHOW ERROR
      // --------------------------------------------------------

      showError(
        "loginError",
        msg
      );


      resetLoginBtn();
    }

  });

})();


// ============================================================
// FORGOT PASSWORD
// ============================================================
//
// IMPORTANT:
//
// The previous version first queried:
//
//   users.where("email", "==", email)
//
// That requires Firestore list permission.
//
// But the password-reset page is available before authentication,
// so the new Firestore rules correctly do NOT allow an unauthenticated
// user to query the users collection.
//
// Therefore, we directly use Firebase Authentication's
// sendPasswordResetEmail().
//
// This keeps Firestore permissions secure.
// ============================================================

(function () {

  const resetForm =
    document.getElementById("resetForm");


  if (!resetForm) {
    return;
  }


  resetForm.addEventListener("submit", async (e) => {

    e.preventDefault();

    hideError("resetError");


    const emailEl =
      document.getElementById("resetEmail");

    const btn =
      document.getElementById("resetBtn");


    if (!emailEl || !btn) {
      return;
    }


    const email =
      emailEl.value.trim();


    // ----------------------------------------------------------
    // VALIDATE EMAIL
    // ----------------------------------------------------------

    if (!email || !email.includes("@")) {

      showError(
        "resetError",
        "Please enter a valid email address."
      );

      return;
    }


    // ----------------------------------------------------------
    // CHECK FIREBASE AUTH
    // ----------------------------------------------------------

    if (
      typeof window.isAuthAvailable !== "function"
      || !window.isAuthAvailable()
    ) {

      showError(
        "resetError",
        "Authentication service is temporarily unavailable. Please try again later."
      );

      return;
    }


    // ----------------------------------------------------------
    // SHOW LOADING STATE
    // ----------------------------------------------------------

    btn.disabled = true;

    btn.innerHTML =
      '<span class="spinner-border spinner-border-sm me-2"></span>Sending...';


    try {

      // --------------------------------------------------------
      // SEND PASSWORD RESET EMAIL
      // --------------------------------------------------------
      //
      // We intentionally do NOT query the Firestore users
      // collection here.
      //
      // Firebase Authentication handles the reset request.
      // --------------------------------------------------------

      await window.auth.sendPasswordResetEmail(email);


      // --------------------------------------------------------
      // SHOW SUCCESS MESSAGE
      // --------------------------------------------------------

      const successEl =
        document.getElementById("resetSuccess");


      if (successEl) {

        successEl.classList.remove("d-none");
      }


      resetForm.classList.add("d-none");


    } catch (err) {

      console.error(
        "Password reset error:",
        err
      );


      let msg =
        "Unable to send the password reset email. Please try again.";


      if (err && err.code) {

        const resetErrorMessages = {

          "auth/invalid-email":
            "Please enter a valid email address.",

          "auth/user-not-found":
            "No account was found with this email address.",

          "auth/network-request-failed":
            "Network error. Check your internet connection and try again.",

          "auth/too-many-requests":
            "Too many requests. Please wait a moment and try again.",

          "auth/user-disabled":
            "This account has been disabled. Contact your Super Admin."
        };


        msg =
          resetErrorMessages[err.code]
          || msg;
      }


      showError(
        "resetError",
        msg
      );


      btn.disabled = false;

      btn.innerHTML =
        "Send Reset Link";
    }

  });

})();


// ============================================================
// ROUTE GUARD
// ============================================================
//
// Used on dashboard.html and other protected CRM pages.
//
// Resolves with:
//
// {
//   uid,
//   email,
//   name,
//   role,
//   ...other user data
// }
//
// only after:
//
// 1. Firebase Authentication confirms the user.
// 2. A matching /users/{uid} document exists.
// 3. The CRM account is active.
// ============================================================

function requireAuth() {

  return new Promise((resolve, reject) => {


    // ----------------------------------------------------------
    // CHECK AUTH SERVICES
    // ----------------------------------------------------------

    if (
      typeof window.isAuthAvailable !== "function"
      || !window.isAuthAvailable()
      || !window.usersRef
    ) {

      console.error(
        "Auth services not available."
      );


      window.location.href =
        "index.html";


      reject(
        new Error(
          "Auth services not available"
        )
      );


      return;
    }


    // ----------------------------------------------------------
    // LISTEN FOR AUTH STATE
    // ----------------------------------------------------------

    window.auth.onAuthStateChanged(
      async (user) => {


        // ------------------------------------------------------
        // USER NOT AUTHENTICATED
        // ------------------------------------------------------

        if (!user) {

          window.location.href =
            "index.html";


          reject(
            new Error(
              "Not authenticated"
            )
          );


          return;
        }


        try {

          // ----------------------------------------------------
          // GET CRM USER PROFILE
          // ----------------------------------------------------

          const userDoc =
            await window.usersRef
              .doc(user.uid)
              .get();


          // ----------------------------------------------------
          // USER PROFILE DOES NOT EXIST
          // ----------------------------------------------------

          if (!userDoc.exists) {

            console.warn(
              "Authenticated user has no CRM profile:",
              user.uid
            );


            await window.auth.signOut();


            window.location.href =
              "index.html";


            reject(
              new Error(
                "User not found in database"
              )
            );


            return;
          }


          // ----------------------------------------------------
          // USER DATA
          // ----------------------------------------------------

          const userData =
            userDoc.data() || {};


          // ----------------------------------------------------
          // CHECK ACTIVE STATUS
          // ----------------------------------------------------

          if (userData.active === false) {

            console.warn(
              "CRM account is inactive:",
              user.uid
            );


            await window.auth.signOut();


            window.location.href =
              "index.html";


            reject(
              new Error(
                "User account is deactivated"
              )
            );


            return;
          }


          // ----------------------------------------------------
          // CHECK ROLE
          // ----------------------------------------------------

          if (!userData.role) {

            console.error(
              "CRM user has no role:",
              user.uid
            );


            await window.auth.signOut();


            window.location.href =
              "index.html";


            reject(
              new Error(
                "User role is missing"
              )
            );


            return;
          }


          // ----------------------------------------------------
          // AUTHENTICATION COMPLETE
          // ----------------------------------------------------

          const authenticatedUser = {

            uid: user.uid,

            email: user.email,

            ...userData

          };


          console.log(
            "CRM authentication verified:",
            {
              uid: authenticatedUser.uid,
              email: authenticatedUser.email,
              role: authenticatedUser.role,
              active: authenticatedUser.active
            }
          );


          resolve(
            authenticatedUser
          );


        } catch (err) {

          // ----------------------------------------------------
          // FIRESTORE / AUTH ERROR
          // ----------------------------------------------------

          console.error(
            "Auth state check error:",
            err
          );


          try {

            await window.auth.signOut();

          } catch (signOutError) {

            console.error(
              "Sign out after auth error failed:",
              signOutError
            );
          }


          window.location.href =
            "index.html";


          reject(err);
        }

      }
    );

  });

}


// ============================================================
// LOGOUT
// ============================================================

function logout() {

  if (
    typeof window.isAuthAvailable === "function"
    && window.isAuthAvailable()
  ) {

    window.auth
      .signOut()

      .then(() => {

        window.location.href =
          "index.html";

      })

      .catch((err) => {

        console.error(
          "Logout error:",
          err
        );

        // Even if Firebase sign-out reports an error,
        // send the user back to the login page.

        window.location.href =
          "index.html";
      });

  } else {

    window.location.href =
      "index.html";
  }

}
