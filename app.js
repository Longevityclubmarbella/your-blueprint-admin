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
  writeResult("Creating client and uploading Blueprint...");

  try {
    const formData = new FormData();
    formData.set("clientName", document.querySelector("#client-name").value.trim());
    formData.set("clientEmail", document.querySelector("#client-email").value.trim());
    formData.set("clientPassword", document.querySelector("#client-password").value);
    formData.set("currentFocus", document.querySelector("#current-focus").value.trim());
    formData.set("deliveredAt", document.querySelector("#delivered-at").value);
    formData.set("blueprintPdf", document.querySelector("#blueprint-pdf").files[0]);

    const response = await fetch(`${SUPABASE_URL}/functions/v1/create-client-blueprint`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: formData,
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || data.message || "Could not create client.");
    }

    writeResult(JSON.stringify(data, null, 2));
    clientForm.reset();
    deliveredAt.valueAsDate = new Date();
  } catch (error) {
    writeResult(error.message, true);
  } finally {
    button.disabled = false;
  }
});

function setLoginStatus(message, isError = false) {
  loginStatus.textContent = message;
  loginStatus.classList.toggle("error", isError);
}

function writeResult(message, isError = false) {
  result.textContent = message;
  result.classList.toggle("error", isError);
}
