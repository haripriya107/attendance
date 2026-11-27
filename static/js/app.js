(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const state = {employees: [], departments: [], attendance: []};
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
  const statusClass = (status) => ({
    Pending: "status-pending", Approved: "status-approved", Rejected: "status-rejected",
    Active: "status-active", Inactive: "status-inactive", admin: "status-admin"
  }[status] || "status-neutral");

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
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.toggle("error", error);
    toast.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("show"), 3200);
  }

  async function loadIdentity() {
    const {user} = await api("/api/auth/me");
    $("#admin-name").textContent = user.name;
    $("#top-avatar").textContent = initials(user.name);
    $("#current-date").textContent = new Date().toLocaleDateString(undefined, {
      weekday: "long", month: "long", day: "numeric", year: "numeric"
    }).toUpperCase();
  }

  async function loadOverview() {
    const result = await api("/api/admin/overview");
    $("#metric-employees").textContent = result.metrics.employees;
    $("#metric-present").textContent = result.metrics.present;
    $("#metric-leave").textContent = result.metrics.on_leave;
    $("#metric-absent").textContent = result.metrics.absent;
    $("#leave-count").textContent = result.pending_leaves.length;
    $("#recent-list").innerHTML = result.recent_attendance.length
      ? result.recent_attendance.map((row) => `
        <div class="compact-row">
          <span class="avatar ${row.department ? "avatar-blue" : "avatar-green"}">${escapeHTML(initials(row.name))}</span>
          <span class="compact-copy"><strong>${escapeHTML(row.name)}</strong><small>${escapeHTML(row.department || "Unassigned")} · ${escapeHTML(dateLabel(row.date, {month: "short", day: "numeric"}))}</small></span>
          <span class="compact-time">${escapeHTML(row.check_in || "—")}</span>
        </div>`).join("")
      : '<div class="pending-empty">No check-ins recorded yet today.</div>';
    $("#pending-preview").innerHTML = result.pending_leaves.length
      ? result.pending_leaves.slice(0, 4).map((row) => `
        <div class="pending-item">
          <span class="avatar avatar-plum">${escapeHTML(initials(row.name))}</span>
          <span class="compact-copy"><strong>${escapeHTML(row.name)}</strong><small>${escapeHTML(dateLabel(row.from_date, {month: "short", day: "numeric"}))} – ${escapeHTML(dateLabel(row.to_date, {month: "short", day: "numeric"}))} · ${escapeHTML(row.reason)}</small></span>
          <button class="table-action" data-review-leave="${row.id}">Review</button>
        </div>`).join("")
      : '<div class="pending-empty">You are all caught up. No requests need review.</div>';
    $$("#pending-preview [data-review-leave]").forEach((button) => {
      button.addEventListener("click", () => {
        openView("leaves");
        loadLeaves("Pending").catch((error) => notify(error.message, true));
      });
    });
    await loadChart();
  }

  async function loadChart() {
    const period = $("#attendance-period").value;
    const result = await api(`/api/admin/attendance/overview?period=${encodeURIComponent(period)}`);
    const selectedLabel = $("#attendance-period").selectedOptions[0].textContent;
    const chart = $("#attendance-chart");
    const max = Math.max(1, ...result.series.map((item) => item.present));
    chart.style.setProperty("--chart-columns", result.series.length);
    chart.dataset.period = period;
    chart.classList.toggle("hidden", result.empty);
    $("#attendance-chart-empty").classList.toggle("hidden", !result.empty);
    $("#attendance-heading").textContent = `Attendance overview · ${selectedLabel}`;
    $("#attendance-period-description").textContent =
      `${result.start_date} – ${result.end_date} · ${result.timezone}`;
    $("#period-present").textContent = result.stats.present;
    $("#period-absent").textContent = result.stats.absent;
    $("#period-leave").textContent = result.stats.on_leave;
    $("#period-hours").textContent = `${Number(result.stats.hours).toFixed(2)} h`;
    chart.innerHTML = result.series.map((item) => `
      <div class="chart-day">
        <div class="chart-bar-track">
        <div class="chart-bar" style="height:${item.present ? Math.max(5, (item.present / max) * 100) : 0}%"
             title="${escapeHTML(item.present)} check-ins${item.date ? ` ${period === "year" ? "in" : "on"} ${escapeHTML(item.date)}` : ""}"></div>
        </div>
        <span>${escapeHTML(item.label)}</span>
      </div>`).join("");
  }

  async function loadEmployees(search = "") {
    const {employees} = await api(`/api/admin/employees?search=${encodeURIComponent(search)}`);
    state.employees = employees;
    $("#employee-count").textContent = `${employees.length} ${employees.length === 1 ? "person" : "people"}`;
    $("#employee-rows").innerHTML = employees.map((employee) => `
      <tr>
        <td><div class="person-cell"><span class="avatar ${employee.role === "admin" ? "avatar-plum" : "avatar-blue"}">${escapeHTML(initials(employee.name))}</span><span><strong>${escapeHTML(employee.name)}</strong><small>${escapeHTML(employee.employee_code || "No ID")} · ${escapeHTML(employee.email)}</small></span></div></td>
        <td>${escapeHTML(employee.department || "—")}</td><td>${escapeHTML(employee.position || "—")}</td>
        <td>${escapeHTML(employee.employment_type || "—")}</td>
        <td><span class="status-pill ${employee.role === "admin" ? "status-admin" : "status-neutral"}">${escapeHTML(employee.role)}</span></td>
        <td><span class="status-pill ${employee.is_active ? "status-active" : "status-inactive"}">${employee.is_active ? "Active" : "Inactive"}</span></td>
        <td><button class="table-action" data-edit-employee="${employee.id}">Edit</button>
        ${employee.role === "employee" ? `<button class="table-action" data-reset-employee-password="${employee.id}">Reset password</button>` : ""}</td>
      </tr>`).join("");
    $("#employee-empty").classList.toggle("hidden", employees.length !== 0);
    $$("#employee-rows [data-edit-employee]").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          const {employee} = await api(`/api/admin/employees/${button.dataset.editEmployee}`);
          await loadDepartments();
          showEmployeeForm(employee);
        } catch (error) { notify(error.message, true); }
      });
    });
    $$("#employee-rows [data-reset-employee-password]").forEach((button) => {
      button.addEventListener("click", () => {
        const employee = employees.find((item) => item.id === Number(button.dataset.resetEmployeePassword));
        if (!employee) return;
        $("#password-reset-form").reset();
        $("#reset-employee-id").value = employee.id;
        $("#reset-employee-name").textContent = employee.name;
        $("#password-reset-message").textContent = "";
        $("#password-reset-dialog").showModal();
      });
    });
    const employeeSelect = $("#report-employee");
    const selected = employeeSelect.value;
    employeeSelect.innerHTML = '<option value="">All employees</option>' + employees
      .filter((employee) => employee.role === "employee")
      .map((employee) => `<option value="${employee.id}">${escapeHTML(employee.name)}</option>`).join("");
    employeeSelect.value = selected;
  }

  async function loadDepartments() {
    const {departments} = await api("/api/admin/departments");
    state.departments = departments;
    $("#department-list").innerHTML = departments.map((department) => `
      <div class="department-card"><span class="department-symbol">▦</span><span>${escapeHTML(department.department_name)}</span><button class="icon-button" data-delete-department="${department.id}" aria-label="Remove ${escapeHTML(department.department_name)}" title="Remove department">×</button></div>
    `).join("");
    $("#department-empty").classList.toggle("hidden", departments.length !== 0);
    $("#form-department").innerHTML = '<option value="">Unassigned</option>' + departments
      .map((department) => `<option value="${escapeHTML(department.department_name)}">${escapeHTML(department.department_name)}</option>`).join("");
    $$("#department-list [data-delete-department]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!window.confirm("Remove this department?")) return;
        try {
          await api(`/api/admin/departments/${button.dataset.deleteDepartment}`, {method: "DELETE"});
          notify("Department removed.");
          await loadDepartments();
        } catch (error) { notify(error.message, true); }
      });
    });
  }

  async function loadAttendance() {
    const params = new URLSearchParams();
    if ($("#report-from").value) params.set("from", $("#report-from").value);
    if ($("#report-to").value) params.set("to", $("#report-to").value);
    if ($("#report-employee").value) params.set("employee_id", $("#report-employee").value);
    const {attendance} = await api(`/api/admin/attendance?${params.toString()}`);
    $("#attendance-rows").innerHTML = attendance.map((row) => `
      <tr><td>${escapeHTML(dateLabel(row.date))}</td>
      <td><div class="person-cell"><span class="avatar avatar-blue">${escapeHTML(initials(row.name))}</span><span><strong>${escapeHTML(row.name)}</strong><small>${escapeHTML(row.employee_code || "")}</small></span></div></td>
      <td>${escapeHTML(row.department || "—")}</td><td>${escapeHTML(row.check_in || "—")}</td><td>${escapeHTML(row.check_out || "—")}</td>
      <td>${row.hours == null ? "—" : `${escapeHTML(row.hours)} h`}</td><td><span class="status-pill status-present">Present</span></td></tr>
    `).join("");
    $("#attendance-empty").classList.toggle("hidden", attendance.length !== 0);
  }

  async function loadLeaves(status = $("#leave-filter").value) {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    const {leaves} = await api(`/api/admin/leaves${query}`);
    $("#leave-rows").innerHTML = leaves.map((leave) => `
      <tr><td><div class="person-cell"><span class="avatar avatar-plum">${escapeHTML(initials(leave.name))}</span><span><strong>${escapeHTML(leave.name)}</strong><small>${escapeHTML(leave.employee_code || "")} · ${escapeHTML(leave.department || "Unassigned")}</small></span></div></td>
      <td>${escapeHTML(dateLabel(leave.from_date))} – ${escapeHTML(dateLabel(leave.to_date))}</td><td title="${escapeHTML(leave.reason)}">${escapeHTML(leave.reason)}</td>
      <td>${escapeHTML(dateLabel((leave.created_at || "").slice(0, 10)))}</td>
      <td><span class="status-pill ${statusClass(leave.status)}">${escapeHTML(leave.status)}</span></td>
      <td>${leave.status === "Pending" ? `<button class="table-action" data-leave-action="Approved" data-leave-id="${leave.id}">Approve</button> <button class="table-action" data-leave-action="Rejected" data-leave-id="${leave.id}">Decline</button>` : "—"}</td></tr>
    `).join("");
    $("#leave-empty").classList.toggle("hidden", leaves.length !== 0);
    $$("#leave-rows [data-leave-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          await api(`/api/admin/leaves/${button.dataset.leaveId}`, {
            method: "PATCH", body: JSON.stringify({status: button.dataset.leaveAction})
          });
          notify(`Request ${button.dataset.leaveAction.toLowerCase()}.`);
          await Promise.all([loadLeaves(), loadOverview()]);
        } catch (error) { notify(error.message, true); }
      });
    });
  }

  function openView(name) {
    $$(".view-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `view-${name}`));
    $$(".nav-item[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
    $("#page-title").textContent = ({overview: "Overview", employees: "Employees", attendance: "Attendance", leaves: "Leave requests", departments: "Departments"})[name];
    if (name === "employees") loadEmployees($("#employee-search").value).catch((error) => notify(error.message, true));
    if (name === "attendance") loadAttendance().catch((error) => notify(error.message, true));
    if (name === "leaves") loadLeaves().catch((error) => notify(error.message, true));
    if (name === "departments") loadDepartments().catch((error) => notify(error.message, true));
    $("#sidebar").classList.remove("open");
  }

  function showEmployeeForm(employee = null) {
    $("#employee-form").reset();
    $("#employee-form-message").textContent = "";
    $("#employee-id").value = employee ? employee.id : "";
    $("#employee-form-title").textContent = employee ? "Edit employee" : "Add employee";
    $("#employee-form-kicker").textContent = employee ? "EMPLOYEE PROFILE" : "NEW TEAM MEMBER";
    $("#save-employee").textContent = employee ? "Save changes" : "Create account";
    $("#password-field").classList.toggle("hidden", Boolean(employee));
    $("#active-field").classList.toggle("hidden", !employee);
    $("#form-password").required = !employee;
    if (employee) {
      $("#form-name").value = employee.name || "";
      $("#form-email").value = employee.email || "";
      $("#form-code").value = employee.employee_code || "";
      $("#form-phone").value = employee.phone || "";
      $("#form-position").value = employee.position || "";
      $("#form-department").value = employee.department || "";
      $("#form-joining").value = employee.joining_date || "";
      $("#form-employment").value = employee.employment_type || "Full-time";
      $("#form-role").value = employee.role || "employee";
      $("#form-active").checked = Boolean(employee.is_active);
    }
    $("#employee-dialog").showModal();
  }

  async function saveEmployee(event) {
    event.preventDefault();
    const employeeId = $("#employee-id").value;
    const payload = {
      name: $("#form-name").value, email: $("#form-email").value,
      employee_code: $("#form-code").value, phone: $("#form-phone").value,
      position: $("#form-position").value, department: $("#form-department").value,
      joining_date: $("#form-joining").value, employment_type: $("#form-employment").value,
      role: $("#form-role").value
    };
    if (employeeId) {
      payload.is_active = $("#form-active").checked;
      payload.password = $("#form-password").value;
    } else {
      payload.password = $("#form-password").value;
    }
    const button = $("#save-employee");
    button.disabled = true;
    $("#employee-form-message").textContent = "";
    try {
      await api(employeeId ? `/api/admin/employees/${employeeId}` : "/api/admin/employees", {
        method: employeeId ? "PUT" : "POST", body: JSON.stringify(payload)
      });
      $("#employee-dialog").close();
      notify(employeeId ? "Employee profile updated." : "Employee account created.");
      await Promise.all([loadEmployees($("#employee-search").value), loadOverview()]);
    } catch (error) {
      $("#employee-form-message").textContent = error.message;
    } finally { button.disabled = false; }
  }

  async function resetEmployeePassword(event) {
    event.preventDefault();
    const employeeId = $("#reset-employee-id").value;
    const button = $("#reset-password-submit");
    button.disabled = true;
    $("#password-reset-message").textContent = "";
    try {
      const result = await api(`/api/admin/employees/${employeeId}/reset-password`, {
        method: "POST",
        body: JSON.stringify({
          temporary_password: $("#reset-temporary-password").value,
          confirm_password: $("#reset-confirm-password").value
        })
      });
      $("#password-reset-dialog").close();
      $("#password-reset-form").reset();
      notify(result.message);
    } catch (error) {
      $("#password-reset-message").textContent = error.message;
    } finally { button.disabled = false; }
  }

  async function exportCSV() {
    const params = new URLSearchParams();
    if ($("#report-from").value) params.set("from", $("#report-from").value);
    if ($("#report-to").value) params.set("to", $("#report-to").value);
    if ($("#report-employee").value) params.set("employee_id", $("#report-employee").value);
    try {
      const response = await fetch(`/api/admin/attendance/export?${params.toString()}`, {
        credentials: "same-origin"
      });
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.message || "The attendance export could not be created.");
      }
      const link = document.createElement("a");
      link.href = URL.createObjectURL(await response.blob());
      link.download = "attendance-report.csv";
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) { notify(error.message, true); }
  }

  let searchTimer;
  $$(".nav-item[data-view]").forEach((button) => button.addEventListener("click", () => openView(button.dataset.view)));
  $$("[data-open-view]").forEach((button) => button.addEventListener("click", () => openView(button.dataset.openView)));
  $("#menu-button").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  $("#logout-button").addEventListener("click", async () => {
    try { await api("/api/auth/logout", {method: "POST"}); window.location.assign("/login"); }
    catch (error) { notify(error.message, true); }
  });
  $("#add-employee").addEventListener("click", async () => {
    try { await loadDepartments(); showEmployeeForm(); }
    catch (error) { notify(error.message, true); }
  });
  $("#employee-form").addEventListener("submit", saveEmployee);
  $$("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => $("#employee-dialog").close()));
  $("#password-reset-form").addEventListener("submit", resetEmployeePassword);
  $$("[data-close-password-dialog]").forEach((button) => {
    button.addEventListener("click", () => $("#password-reset-dialog").close());
  });
  $("#employee-search").addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => loadEmployees($("#employee-search").value).catch((error) => notify(error.message, true)), 200);
  });
  $("#department-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/admin/departments", {
        method: "POST", body: JSON.stringify({department_name: $("#department-name").value})
      });
      $("#department-form").reset();
      notify("Department added.");
      await loadDepartments();
    } catch (error) { notify(error.message, true); }
  });
  $("#filter-report").addEventListener("click", () => loadAttendance().catch((error) => notify(error.message, true)));
  $("#export-report").addEventListener("click", exportCSV);
  $("#leave-filter").addEventListener("change", () => loadLeaves().catch((error) => notify(error.message, true)));
  $("#attendance-period").addEventListener("change", () => {
    loadChart().catch((error) => notify(error.message, true));
  });

  Promise.all([loadIdentity(), loadOverview(), loadEmployees(), loadDepartments()])
    .catch((error) => notify(error.message, true));
})();
