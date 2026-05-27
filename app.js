const SUPABASE_URL = "https://wnmjyufegiszejbearzm.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_8Vxib-xqb8FEjVpVla1BGA_iNubE23Y";

const loginForm = document.querySelector("#login-form");
const clientForm = document.querySelector("#client-form");
const loginStatus = document.querySelector("#login-status");
const result = document.querySelector("#result");
const deliveredAt = document.querySelector("#delivered-at");
let accessToken = localStorage.getItem("yb_admin_access_token") || "";

deliveredAt.valueAsDate = new Date();
setLoginStatus(accessToken ? "Signed in. Ready to create clients." : "Not signed in.");

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = loginForm.querySelector("button");
  button.disabled = true;
  setLoginStatus("Signing in...");

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: document.querySelector("#admin-email").value.trim(),
        password: document.querySelector("#admin-password").value,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error_description || data.message || "Could not sign in.");
    }

    accessToken = data.access_token;
    localStorage.setItem("yb_admin_access_token", accessToken);
    setLoginStatus("Signed in. Ready to create clients.");
  } catch (error) {
    setLoginStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
});

clientForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!accessToken) {
    writeResult("Sign in as admin first.", true);
    return;
  }

  const button = clientForm.querySelector("button");
  button.disabled = true;
  writeResult("Creating client login...");

  try {
    const pdfFile = document.querySelector("#blueprint-pdf").files[0];
    if (!pdfFile) {
      throw new Error("Choose a Blueprint PDF first.");
    }

    const currentFocus = document.querySelector("#current-focus").value.trim();
    const deliveredDate = document.querySelector("#delivered-at").value;
    const payload = {
      clientName: document.querySelector("#client-name").value.trim(),
      clientEmail: document.querySelector("#client-email").value.trim(),
      clientPassword: document.querySelector("#client-password").value,
      currentFocus,
      deliveredAt: deliveredDate,
      fileName: pdfFile.name,
    };

    const response = await fetch(`${SUPABASE_URL}/functions/v1/create-client-blueprint`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || data.message || "Could not create client.");
    }

    writeResult("Uploading PDF directly to Supabase Storage...");
    await uploadBlueprintPdf(data.storage.path, pdfFile);

    writeResult("Publishing Blueprint record...");
    const upload = await createUploadRecord(data.client.id, data.storage.path, pdfFile.name);
    const report = await createBlueprintReport(
      data.client.id,
      upload.id,
      deliveredDate,
      currentFocus,
      pdfFile.name,
    );

    writeResult(JSON.stringify({ ...data, upload, report }, null, 2));
    clientForm.reset();
    deliveredAt.valueAsDate = new Date();
  } catch (error) {
    const message = error.message === "Failed to fetch"
      ? "Could not reach the Supabase function. Redeploy it with JWT verification disabled, then try again."
      : error.message;
    writeResult(message, true);
  } finally {
    button.disabled = false;
  }
});

async function uploadBlueprintPdf(storagePath, pdfFile) {
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/blueprint-reports/${encodeStoragePath(storagePath)}`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/pdf",
        "x-upsert": "true",
      },
      body: pdfFile,
    },
  );
  await assertOk(response, "Could not upload PDF to Storage.");
}

async function createUploadRecord(clientId, storagePath, originalFilename) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/uploads`, {
    method: "POST",
    headers: restHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify([{
      client_id: clientId,
      uploaded_by: userIdFromToken(accessToken),
      upload_type: "blueprint",
      file_path: storagePath,
      original_filename: originalFilename,
      status: "approved",
    }]),
  });
  const rows = await assertOk(response, "Could not create upload record.");
  return rows[0];
}

async function createBlueprintReport(clientId, uploadId, deliveredDate, currentFocus, fileName) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/blueprint_reports`, {
    method: "POST",
    headers: restHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify([{
      client_id: clientId,
      upload_id: uploadId,
      delivered_at: deliveredDate || new Date().toISOString().slice(0, 10),
      current_focus: currentFocus,
      summary_json: {
        status: "reviewed",
        source_pdf: fileName,
        primary_priorities: [],
      },
      protocol_json: {
        current_phase: "Week 1-2",
        daily_checkin: true,
        blood_retest_window: "8-12 weeks",
      },
      approved_at: new Date().toISOString(),
    }]),
  });
  const rows = await assertOk(response, "Could not publish Blueprint report.");
  return rows[0];
}

function restHeaders(extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function assertOk(response, fallbackMessage) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.error || data.message || fallbackMessage);
  }
  return data;
}

function encodeStoragePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function userIdFromToken(token) {
  try {
    return JSON.parse(atob(token.split(".")[1])).sub;
  } catch {
    return null;
  }
}

function setLoginStatus(message, isError = false) {
  loginStatus.textContent = message;
  loginStatus.classList.toggle("error", isError);
}

function writeResult(message, isError = false) {
  result.textContent = message;
  result.classList.toggle("error", isError);
}
