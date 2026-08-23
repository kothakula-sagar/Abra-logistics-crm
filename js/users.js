// ============================================================
// USERS.JS — Super Admin only: add/manage Admins & Members
//
// NOTE: Firebase client SDK signs in as the newly created user
// the moment you call createUserWithEmailAndPassword(). To avoid
// kicking the Super Admin out of their own session, we spin up a
// SECONDARY Firebase app instance just for account creation, then
// discard it. No Cloud Functions / paid plan required.
// ============================================================

let ALL_USERS = [];

async function loadUsersView() {
  usersRef.onSnapshot((snap) => {
    ALL_USERS = [];
    snap.forEach((doc) => ALL_USERS.push({ id: doc.id, ...doc.data() }));
    ALL_USERS.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    renderUsersTable();
  });
}

function renderUsersTable() {
  const tbody = document.getElementById("usersTableBody");
  if (!tbody) return;

  tbody.innerHTML = ALL_USERS.map((u) => `
    <tr>
      <td>${escapeHtml(u.name)}</td>
      <td>${escapeHtml(u.email)}</td>
      <td><span class="badge ${u.role === "superadmin" ? "bg-dark" : u.role === "admin" ? "bg-primary" : u.role === "hr" ? "bg-info text-dark" : "bg-secondary"}">${ROLE_LABELS[u.role] || u.role}</span></td>
      <td>${u.active === false ? '<span class="badge bg-danger">Inactive</span>' : '<span class="badge bg-success">Active</span>'}</td>
      <td>${u.telegramConnected ? '<span class="badge bg-success"><i class="bi bi-telegram me-1"></i>Connected</span>' : '<span class="badge bg-secondary">Not connected</span>'}</td>
      <td class="text-nowrap">
        ${u.role !== "superadmin" ? `
          <select class="form-select form-select-sm d-inline-block w-auto" onchange="changeUserRole('${u.id}', this.value)">
            <option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin</option>
            <option value="member" ${u.role === "member" ? "selected" : ""}>Sales Member</option>
            <option value="hr" ${u.role === "hr" ? "selected" : ""}>HR</option>
          </select>
          <button class="btn btn-sm ${u.active === false ? "btn-outline-success" : "btn-outline-warning"}" onclick="toggleUserActive('${u.id}', ${u.active === false})">
            ${u.active === false ? "Activate" : "Deactivate"}
          </button>
        ` : `<span class="text-muted small">Protected</span>`}
      </td>
    </tr>`).join("");
}

// ---------------- ADD MEMBER / ADMIN ----------------
const addUserForm = document.getElementById("addUserForm");
if (addUserForm) {
  addUserForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!hasPermission("manageTeam.createUser")) {
      toast("You don't have permission to create team members.", "warning");
      return;
    }

    const btn = document.getElementById("addUserSubmitBtn");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Adding...';

    const name = document.getElementById("newUserName").value.trim();
    const email = document.getElementById("newUserEmail").value.trim();
    const password = document.getElementById("newUserPassword").value;
    const role = document.getElementById("newUserRole").value;

    // Secondary app instance so Super Admin's session is untouched
    let secondaryApp = null;
    try {
      secondaryApp = firebase.initializeApp(window.firebaseConfig, "Secondary-" + Date.now());

      const cred = await secondaryApp.auth().createUserWithEmailAndPassword(email, password);
      const newUid = cred.user.uid;

      await usersRef.doc(newUid).set({
        name,
        email,
        role,
        active: true,
        createdBy: CURRENT_USER.uid,
        createdAt: firebase.firestore.Timestamp.now()
      });

      await secondaryApp.auth().signOut();
      await secondaryApp.delete();
      secondaryApp = null;

      addUserForm.reset();
      bootstrap.Modal.getInstance(document.getElementById("addUserModal")).hide();
      toast(`${ROLE_LABELS[role]} account created for ${name}.`, "success");
      await refreshActiveMembers();
      if (typeof refreshActiveHR === "function") await refreshActiveHR();
    } catch (err) {
      console.error(err);
      let msg = "Failed to create account.";
      if (err.code === "auth/email-already-in-use") msg = "This email is already registered.";
      if (err.code === "auth/weak-password") msg = "Password should be at least 6 characters.";
      toast(msg, "danger");
    } finally {
      if (secondaryApp) {
        try { await secondaryApp.auth().signOut(); } catch (_) {}
        try { await secondaryApp.delete(); } catch (_) {}
      }
      btn.disabled = false;
      btn.innerHTML = "Add Team Member";
    }
  });
}

// ---------------- ROLE / ACTIVE TOGGLE ----------------
async function changeUserRole(uid, newRole) {
  if (!hasPermission("manageTeam.changeRole")) {
    toast("You don't have permission to change roles.", "warning");
    return;
  }

  try {
    await usersRef.doc(uid).update({ role: newRole });
    toast("Role updated.", "success");
    await refreshActiveMembers();
    if (typeof refreshActiveHR === "function") await refreshActiveHR();
  } catch (err) {
    console.error(err);
    toast("Failed to update role.", "danger");
  }
}

async function toggleUserActive(uid, makeActive) {
  if (!hasPermission("manageTeam.activateDeactivate")) {
    toast("You don't have permission to change user status.", "warning");
    return;
  }

  try {
    await usersRef.doc(uid).update({ active: makeActive });
    toast(makeActive ? "User activated." : "User deactivated.", "success");
    await refreshActiveMembers();
    if (typeof refreshActiveHR === "function") await refreshActiveHR();
  } catch (err) {
    console.error(err);
    toast("Failed to update status.", "danger");
  }
}
