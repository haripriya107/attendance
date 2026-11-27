(() => {
  const $ = (selector) => document.querySelector(selector);
  let todayRecord = null;
  let onLeaveToday = false;
  let elapsedSeconds = null;
  let durationUpdatedAt = 0;
  let mustChangePassword = false;
  let workspaceLoaded = false;
  let toastTimer;
  const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const dateLabel = (value, options = {month: "short", day: "numeric", year: "numeric"}) => {
    if (!value) return "—";
    const parsed = new Date(`${value}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString(undefined, options);
  };
  const localISODate = (date = new Date()) => {
    const pad = (part) => String(part).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };
  const timeLabel = (value) => value ? value.slice(0, 5) : "—";

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      credentials: "same-origin",
      headers: {"Content-Type": "application/json", ...(options.headers || {})}
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.assign("/login");
      throw new Error("Please sign in again.");
    }
    if (!response.ok) throw new Error(result.message || "The request could not be completed.");
    return result;
  }

  function notify(message, error = false) {
    const toast = $("#employee-toast");
    toast.textContent = message;
    toast.classList.toggle("error", error);
    toast.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("show"), 3200);
  }

  function setStatus(label, className) {
    const status = $("#attendance-status");
    status.textContent = label;
    status.className = `status-pill ${className}`;
  }

  function updateButtons() {
    const checkedIn = Boolean(todayRecord?.check_in);
    const checkedOut = Boolean(todayRecord?.check_out);
    $("#check-in-button").disabled = checkedIn || onLeaveToday;
    $("#check-out-button").disabled = !checkedIn || checkedOut;
    if (onLeaveToday && !checkedIn) setStatus("On approved leave", "status-approved");
    else if (!checkedIn) setStatus("Not checked in", "status-neutral");
    else if (checkedOut) setStatus("Day complete", "status-approved");
    else setStatus("Currently working", "status-pending");
  }

  function updateDuration() {
    const target = $("#hours-worked");
    if (!todayRecord?.check_in) {
      target.textContent = "—";
      return;
    }
    if (todayRecord.check_out) {
      target.textContent = `${(elapsedSeconds / 3600).toFixed(2)} h`;
      return;
    }
    const elapsed = Math.max(0, elapsedSeconds + (performance.now() - durationUpdatedAt) / 1000);
    target.textContent = `${(elapsed / 3600).toFixed(2)} h`;
  }

  function renderProfile(employee) {
    const name = employee.name || "Employee";
    const monogram = initials(name);
    $("#employee-name").textContent = name;
    $("#employee-position").textContent = employee.position || "Team member";
    $("#employee-avatar").textContent = monogram;
    $("#employee-top-avatar").textContent = monogram;
    $("#profile-avatar").textContent = monogram;
    $("#profile-name").textContent = name;
    $("#profile-title").textContent = employee.position || "Team member";
    $("#profile-code").textContent = employee.employee_code || "—";
    $("#profile-department").textContent = employee.department || "Unassigned";
    $("#profile-email").textContent = employee.email;
    $("#profile-employment").textContent = employee.employment_type || "—";
    $("#edit-profile-name").value = employee.name || "";
    $("#edit-profile-phone").value = employee.phone || "";
    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    $("#welcome-name").textContent = `${greeting}, ${name.split(/\s+/)[0]}.`;
  }

  async function loadProfile() {
    const {employee} = await api("/api/employee/profile");
    mustChangePassword = Boolean(employee.must_change_password);
    renderProfile(employee);
    $("#password-required-message").classList.toggle("hidden", !mustChangePassword);
    $("#close-profile-dialog").classList.toggle("hidden", mustChangePassword);
    if (mustChangePassword && !$("#profile-dialog").open) $("#profile-dialog").showModal();
    return employee;
  }

  async function loadWorkspace() {
    await Promise.all([loadToday(), loadHistory(), loadLeaves()]);
    workspaceLoaded = true;
  }

  async function loadToday() {
    const data = await api("/api/attendance/today");
    todayRecord = data.record ? {...data.record, date: data.date} : null;
    onLeaveToday = data.on_leave;
    elapsedSeconds = data.elapsed_seconds;
    durationUpdatedAt = performance.now();
    $("#today-long-date").textContent = dateLabel(data.date, {weekday: "long", month: "long", day: "numeric", year: "numeric"});
    $("#employee-date").textContent = new Date().toLocaleDateString(undefined, {
      weekday: "long", month: "long", day: "numeric", year: "numeric"
    }).toUpperCase();
    $("#check-in-time").textContent = timeLabel(todayRecord?.check_in);
    $("#check-out-time").textContent = timeLabel(todayRecord?.check_out);
    updateButtons();
    updateDuration();
  }

  async function loadHistory() {
    const {attendance} = await api("/api/attendance/history");
    $("#history-rows").innerHTML = attendance.map((row) => `
      <tr><td>${escapeHTML(dateLabel(row.date))}</td>
      <td>${escapeHTML(new Date(`${row.date}T00:00:00`).toLocaleDateString(undefined, {weekday: "long"}))}</td>
      <td>${escapeHTML(timeLabel(row.check_in))}</td><td>${escapeHTML(timeLabel(row.check_out))}</td>
      <td>${row.hours == null ? "—" : `${escapeHTML(row.hours)} h`}</td>
      <td><span class="status-pill status-present">${escapeHTML(row.status || "Present")}</span></td></tr>
    `).join("");
    $("#history-empty").classList.toggle("hidden", attendance.length > 0);
  }

  async function loadLeaves() {
    const {leaves} = await api("/api/employee/leaves");
    $("#my-leave-list").innerHTML = leaves.map((leave) => `
      <div class="leave-request-row">
        <span><strong>${escapeHTML(dateLabel(leave.from_date))} – ${escapeHTML(dateLabel(leave.to_date))}</strong><small>Submitted ${escapeHTML(dateLabel((leave.created_at || "").slice(0, 10)))}</small></span>
        <span class="leave-reason-text"><strong>${escapeHTML(leave.reason)}</strong><small>Time-off request</small></span>
        <span class="status-pill ${leave.status === "Approved" ? "status-approved" : leave.status === "Rejected" ? "status-rejected" : "status-pending"}">${escapeHTML(leave.status)}</span>
      </div>
    `).join("");
    $("#my-leave-empty").classList.toggle("hidden", leaves.length > 0);
  }

  async function handlePunch(endpoint) {
    const button = endpoint === "check-in" ? $("#check-in-button") : $("#check-out-button");
    button.disabled = true;
    try {
      const result = await api(`/api/attendance/${endpoint}`, {method: "POST"});
      notify(result.message);
      await Promise.all([loadToday(), loadHistory()]);
    } catch (error) {
      notify(error.message, true);
      await loadToday().catch(() => {});
    }
  }

  $("#check-in-button").addEventListener("click", () => handlePunch("check-in"));
  $("#check-out-button").addEventListener("click", () => handlePunch("check-out"));
  $("#edit-profile").addEventListener("click", async () => {
    try {
      await loadProfile();
      $("#profile-dialog").showModal();
    } catch (error) { notify(error.message, true); }
  });
  $("#close-profile-dialog").addEventListener("click", () => {
    if (!mustChangePassword) $("#profile-dialog").close();
  });
  $("#profile-dialog").addEventListener("cancel", (event) => {
    if (mustChangePassword) event.preventDefault();
  });
  $("#profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    $("#profile-form-message").textContent = "";
    try {
      await api("/api/employee/profile", {
        method: "PUT",
        body: JSON.stringify({
          name: $("#edit-profile-name").value,
          phone: $("#edit-profile-phone").value
        })
      });
      await loadProfile();
      notify("Profile updated.");
    } catch (error) {
      $("#profile-form-message").textContent = error.message;
    } finally { button.disabled = false; }
  });
  $("#password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    $("#password-form-message").textContent = "";
    try {
      await api("/api/employee/password", {
        method: "POST",
        body: JSON.stringify({
          current_password: $("#current-password").value,
          new_password: $("#new-password").value,
          confirm_password: $("#confirm-password").value
        })
      });
      $("#password-form").reset();
      await loadProfile();
      $("#profile-dialog").close();
      notify("Password changed successfully.");
      if (!workspaceLoaded) await loadWorkspace();
    } catch (error) {
      $("#password-form-message").textContent = error.message;
    } finally { button.disabled = false; }
  });
  $("#employee-menu-button").addEventListener("click", () => {
    document.querySelector(".employee-sidebar").classList.toggle("open");
  });
  document.querySelectorAll(".employee-sidebar .nav-item").forEach((link) => {
    link.addEventListener("click", () => document.querySelector(".employee-sidebar").classList.remove("open"));
  });
  $("#open-leave-form").addEventListener("click", () => {
    $("#leave-form-wrap").classList.remove("hidden");
    $("#leave-from").min = localISODate();
    $("#leave-to").min = $("#leave-from").min;
    $("#leave-from").focus();
  });
  $("#cancel-leave").addEventListener("click", () => {
    $("#leave-form-wrap").classList.add("hidden");
    $("#leave-form").reset();
    $("#leave-message").textContent = "";
  });
  $("#leave-from").addEventListener("change", () => { $("#leave-to").min = $("#leave-from").value; });
  $("#leave-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    $("#leave-message").textContent = "";
    try {
      const result = await api("/api/employee/leaves", {
        method: "POST",
        body: JSON.stringify({
          from_date: $("#leave-from").value,
          to_date: $("#leave-to").value,
          reason: $("#leave-reason").value
        })
      });
      notify(result.message);
      $("#leave-form").reset();
      $("#leave-form-wrap").classList.add("hidden");
      await loadLeaves();
    } catch (error) { $("#leave-message").textContent = error.message; }
    finally { button.disabled = false; }
  });
  $("#employee-logout").addEventListener("click", async () => {
    try { await api("/api/auth/logout", {method: "POST"}); window.location.assign("/login"); }
    catch (error) { notify(error.message, true); }
  });

  const clock = () => {
    $("#live-clock").textContent = new Date().toLocaleTimeString(undefined, {
      hour: "2-digit", minute: "2-digit", hour12: true
    });
    updateDuration();
  };
  clock();
  window.setInterval(clock, 30000);
  loadProfile().then((employee) => {
    if (!employee.must_change_password) return loadWorkspace();
    return null;
  }).catch((error) => notify(error.message, true));
})();
