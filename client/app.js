const SUPABASE_URL = "https://wnmjyufegiszejbearzm.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_8Vxib-xqb8FEjVpVla1BGA_iNubE23Y";
const SESSION_KEY = "yb_client_session";
const INSTALL_DISMISSED_KEY = "yb_install_prompt_dismissed_at";

const state = {
  session: null,
  client: null,
  checkins: [],
  blueprint: pendingBlueprint("Client"),
  activeTab: "today",
  installPromptEvent: null,
  askAnswer: "",
  askClientId: "",
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  bindEvents();
  registerServiceWorker();
  updateInstallShortcutVisibility();
  restoreSession();
});

function cacheElements() {
  [
    "login-screen",
    "main-app",
    "login-form",
    "login-status",
    "email",
    "password",
    "client-name",
    "sync-status",
    "sign-out",
    "refresh-data",
    "blueprint-date",
    "hero-focus",
    "hero-message",
    "biology-profile-label",
    "biology-lens-title",
    "biology-lens-copy",
    "biology-lens-explain",
    "biology-lens-list",
    "today-actions",
    "priority-list",
    "biology-list",
    "food-tags",
    "food-logic-explain",
    "food-suggestions",
    "safety-list",
    "ask-form",
    "ask-question",
    "ask-status",
    "ask-suggestions",
    "ask-answer",
    "checkin-form",
    "checkin-status",
    "recent-checkins",
    "signals-chart",
    "upload-labs",
    "lab-file",
    "lab-status",
    "biomarker-list",
    "phase-list",
    "training-headline",
    "training-list",
    "supplement-list",
    "install-prompt",
    "install-copy",
    "install-steps",
    "install-action",
    "install-dismiss",
    "install-shortcut",
    "explain-sheet",
    "explain-kicker",
    "explain-title",
    "explain-body",
    "explain-status",
    "explain-close",
  ].forEach((id) => {
    els[toCamel(id)] = document.getElementById(id);
  });

  ["energy", "sleep", "gut", "recovery"].forEach((id) => {
    els[toCamel(id)] = document.getElementById(id);
    els[`${toCamel(id)}Value`] = document.getElementById(`${id}-value`);
  });
  els.note = document.getElementById("note");
  els.navButtons = Array.from(document.querySelectorAll(".nav-button"));
  els.tabPanels = Array.from(document.querySelectorAll(".tab-panel"));
}

function bindEvents() {
  window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  window.addEventListener("appinstalled", hideInstallPrompt);
  els.loginForm.addEventListener("submit", handleLogin);
  els.signOut.addEventListener("click", signOut);
  els.refreshData.addEventListener("click", () => syncAll());
  document.getElementById("start-checkin").addEventListener("click", () => setTab("checkin"));
  els.biologyLensExplain.addEventListener("click", explainBiologyLens);
  els.foodLogicExplain.addEventListener("click", explainFoodLogic);
  els.askForm.addEventListener("submit", askBlueprintQuestion);
  els.checkinForm.addEventListener("submit", saveCheckIn);
  els.uploadLabs.addEventListener("click", () => els.labFile.click());
  els.labFile.addEventListener("change", uploadLabFile);
  els.installAction.addEventListener("click", installApp);
  els.installDismiss.addEventListener("click", dismissInstallPrompt);
  els.installShortcut.addEventListener("click", showInstallInstructions);
  els.explainClose.addEventListener("click", closeExplanation);
  els.explainSheet.addEventListener("click", (event) => {
    if (event.target === els.explainSheet) closeExplanation();
  });

  ["energy", "sleep", "gut", "recovery"].forEach((id) => {
    const input = els[toCamel(id)];
    const output = els[`${toCamel(id)}Value`];
    input.addEventListener("input", () => {
      output.textContent = input.value;
    });
  });

  els.navButtons.forEach((button) => {
    button.addEventListener("click", () => setTab(button.dataset.tab));
  });
}

async function handleLogin(event) {
  event.preventDefault();
  setLoginStatus("Signing in...");
  const button = els.loginForm.querySelector("button");
  button.disabled = true;

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: els.email.value.trim(),
        password: els.password.value,
      }),
    });
    const data = await parseResponse(response, "Could not sign in.");
    const nextSession = sessionFromAuthResponse(data);
    resetAccountData();
    state.session = nextSession;
    saveSession();
    showMainApp();
    renderApp();
    await syncAll();
  } catch (error) {
    setLoginStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
}

function restoreSession() {
  try {
    const saved = JSON.parse(storageRead(SESSION_KEY) || "null");
    if (!saved?.accessToken) {
      showLogin();
      return;
    }
    state.session = saved;
    showMainApp();
    syncAll();
  } catch {
    storageRemove(SESSION_KEY);
    showLogin();
  }
  window.setTimeout(maybeShowInstallPrompt, 800);
}

async function refreshSessionIfNeeded() {
  if (!state.session) return;
  const expiresAt = Number(state.session.expiresAt || 0);
  const shouldRefresh = state.session.refreshToken && Date.now() / 1000 > expiresAt - 90;
  if (!shouldRefresh) return;

  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh_token: state.session.refreshToken }),
  });
  const data = await parseResponse(response, "Session expired. Sign in again.");
  state.session = sessionFromAuthResponse(data);
  saveSession();
}

function sessionFromAuthResponse(data) {
  const user = data.user || {};
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
    userId: user.id || decodeUserId(data.access_token),
    email: user.email || "",
  };
}

function saveSession() {
  storageWrite(SESSION_KEY, JSON.stringify(state.session));
}

function signOut() {
  state.session = null;
  resetAccountData();
  storageRemove(SESSION_KEY);
  showLogin();
}

async function syncAll() {
  if (!state.session) return;
  setSyncStatus("Refreshing client data...");

  try {
    await refreshSessionIfNeeded();
    const previousClientId = state.client?.id || "";
    const client = await fetchClient();
    if ((previousClientId && previousClientId !== client.id) || (state.askClientId && state.askClientId !== client.id)) {
      clearAskState();
    }
    state.client = client;
    state.checkins = await fetchCheckIns(client.id);
    const report = await fetchLatestReport(client.id);
    state.blueprint = report
      ? blueprintFromReport(report, client.displayName)
      : pendingBlueprint(client.displayName);
    renderApp();
    setSyncStatus(report ? "Connected to LCM. Blueprint is synced." : "Connected to LCM. Blueprint is pending.");
  } catch (error) {
    setSyncStatus(error.message);
    renderApp();
  }
}

async function fetchClient() {
  const encodedUserId = encodeURIComponent(state.session.userId);
  const rows = await restGet(`/rest/v1/clients?select=id,display_name,status&user_id=eq.${encodedUserId}&limit=1`);
  if (Array.isArray(rows) && rows[0]) {
    return {
      id: rows[0].id,
      displayName: rows[0].display_name,
      status: rows[0].status,
    };
  }

  const profileName = (state.session.email || "LCM Client").split("@")[0];
  const created = await restPost("/rest/v1/rpc/create_own_client", { display_name: profileName });
  return {
    id: created.id,
    displayName: created.display_name,
    status: created.status,
  };
}

async function fetchCheckIns(clientId) {
  const rows = await restGet(
    `/rest/v1/daily_checkins?select=id,checkin_date,energy,sleep,gut,recovery,note&client_id=eq.${clientId}&order=checkin_date.desc`,
  );
  return rows.map((row) => ({
    id: row.id,
    date: row.checkin_date,
    energy: row.energy,
    sleep: row.sleep,
    gut: row.gut,
    recovery: row.recovery,
    note: row.note || "",
  }));
}

async function fetchLatestReport(clientId) {
  const rows = await restGet(
    `/rest/v1/blueprint_reports?select=id,delivered_at,current_focus,summary_json,protocol_json&client_id=eq.${clientId}&order=created_at.desc&limit=1`,
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function saveCheckIn(event) {
  event.preventDefault();
  if (!state.session || !state.client) return;

  setCheckinStatus("Saving check-in...");
  const row = {
    id: randomId(),
    client_id: state.client.id,
    user_id: state.session.userId,
    checkin_date: todayIso(),
    energy: Number(els.energy.value),
    sleep: Number(els.sleep.value),
    gut: Number(els.gut.value),
    recovery: Number(els.recovery.value),
    note: els.note.value.trim(),
  };

  try {
    await restPost("/rest/v1/daily_checkins?on_conflict=client_id,checkin_date", [row], {
      Prefer: "resolution=merge-duplicates,return=minimal",
    });
    els.note.value = "";
    state.checkins = await fetchCheckIns(state.client.id);
    renderCheckIn();
    renderTrends();
    setCheckinStatus("Check-in synced with LCM.");
    setSyncStatus("Daily data is synced.");
  } catch (error) {
    setCheckinStatus(error.message, true);
  }
}

async function uploadLabFile() {
  const file = els.labFile.files[0];
  if (!file || !state.client || !state.session) return;

  setLabStatus("Uploading lab file...");
  const storedName = `${randomId()}-${file.name.replace(/ /g, "-")}`;
  const storagePath = `${state.client.id}/${storedName}`;
  try {
    await fetchSupabase(`/storage/v1/object/lab-results/${encodeStoragePath(storagePath)}`, {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "x-upsert": "true",
      },
      body: file,
    });
    await restPost("/rest/v1/uploads", [{
      client_id: state.client.id,
      uploaded_by: state.session.userId,
      upload_type: "blood",
      file_path: storagePath,
      original_filename: file.name,
      status: "uploaded",
    }], { Prefer: "return=minimal" });
    setLabStatus(`${file.name} uploaded for LCM review.`);
  } catch (error) {
    setLabStatus(error.message, true);
  } finally {
    els.labFile.value = "";
  }
}

async function restGet(path) {
  return fetchSupabase(path, { method: "GET" });
}

async function restPost(path, body, extraHeaders = {}) {
  return fetchSupabase(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

async function fetchSupabase(path, options = {}) {
  await refreshSessionIfNeeded();
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${state.session.accessToken}`,
      ...(options.headers || {}),
    },
  });
  return parseResponse(response, "Supabase request failed.");
}

async function parseResponse(response, fallbackMessage) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.error_description || data?.message || data?.error || fallbackMessage);
  }
  return data;
}

function showLogin() {
  els.loginScreen.hidden = false;
  els.mainApp.hidden = true;
  setLoginStatus("Use the login details from LCM.");
}

function showMainApp() {
  els.loginScreen.hidden = true;
  els.mainApp.hidden = false;
  setTab(state.activeTab);
}

function resetAccountData(clientName = "Client") {
  state.client = null;
  state.checkins = [];
  state.blueprint = pendingBlueprint(clientName);
  clearAskState();
}

function clearAskState() {
  state.askAnswer = "";
  state.askClientId = "";
  if (els.askQuestion) els.askQuestion.value = "";
  if (els.askStatus) setAskStatus("Answers use your loaded Blueprint context.");
  if (els.askAnswer) renderAskAnswer("Your answer will appear here.");
}

function setTab(tabName) {
  state.activeTab = tabName;
  els.navButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });
  els.tabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${tabName}`);
  });
}

function renderApp() {
  const blueprint = state.blueprint;
  els.clientName.textContent = blueprint.clientName;
  els.blueprintDate.textContent = blueprint.reportDate ? `Blueprint delivered ${blueprint.reportDate}` : "Blueprint pending";
  els.heroFocus.textContent = blueprint.currentFocus;
  els.heroMessage.textContent = blueprint.message;
  els.note.placeholder = notePlaceholder(blueprint.profile.key);
  renderToday();
  renderBlueprint();
  renderAsk();
  renderCheckIn();
  renderTrends();
  renderProtocol();
}

function renderToday() {
  const blueprint = state.blueprint;
  renderBiologyLens(blueprint.profile);
  renderList(els.todayActions, blueprint.todayPlan, (item) => itemCard({
    title: item.title,
    body: item.detail,
    badge: item.layer || "Today",
    explain: explanationPayload("Today action", item.title, item.detail, item.layer || "Today"),
  }));
  renderList(els.priorityList, blueprint.priorities.slice(0, 4), (priority) => itemCard({
    title: priority.title,
    body: priority.why,
    badge: priority.layer,
    badgeClass: layerClass(priority.layer),
    rank: priority.rank,
    footer: priority.nextAction,
    explain: explanationPayload("Priority", priority.title, priority.why, priority.layer, priority.nextAction),
  }));
}

function renderBiologyLens(profile) {
  els.biologyProfileLabel.textContent = profile.label;
  els.biologyLensTitle.textContent = profile.title;
  els.biologyLensCopy.textContent = profile.copy;
  renderList(els.biologyLensList, profile.items, (item) => itemCard({
    title: item.title,
    body: item.detail,
    badge: item.badge,
    badgeClass: item.className,
    explain: explanationPayload("Biology lens", item.title, item.detail, item.badge),
  }));
}

function explainBiologyLens() {
  const profile = state.blueprint.profile || biologyProfile("unknown");
  const details = profile.items.map((item) => `${item.title}: ${item.detail}`).join(" ");
  openExplanation(explanationPayload(
    "Biology lens",
    profile.title,
    `${profile.copy} ${details}`.trim(),
    profile.label,
  ));
}

function renderBlueprint() {
  const blueprint = state.blueprint;
  renderList(els.biologyList, blueprint.layers, (layer) => itemCard({
    title: layer.name,
    body: layer.signal,
    badge: layer.status,
    badgeClass: layerClass(layer.name),
    footer: layer.decision,
    explain: explanationPayload("Biology layer", layer.name, layer.signal, layer.status, layer.decision),
  }));
  renderTags(els.foodTags, blueprint.foodFocus, (tag) => openExplanation(explanationPayload(
    "Food logic",
    tag,
    "This is one of the temporary food rules from the Blueprint.",
    "Food",
  )));
  renderList(els.foodSuggestions, blueprint.foodSuggestions, (item) => itemCard({
    title: item.title,
    body: item.detail,
    badge: item.badge,
    badgeClass: "food",
    footer: item.note,
    explain: explanationPayload("Protein breakfast idea", item.title, item.detail, "Food", item.note),
  }), "No breakfast suggestions published yet.");
  renderList(els.safetyList, blueprint.safetyNotes, (note) => itemCard({
    title: "Review note",
    body: note,
    badge: "Safety",
    explain: explanationPayload("Safety note", "Review note", note, "Safety"),
  }));
}

function explainFoodLogic() {
  const rules = state.blueprint.foodFocus?.length
    ? state.blueprint.foodFocus.join("; ")
    : "Food logic will appear after the Blueprint has been extracted.";
  const suggestions = state.blueprint.foodSuggestions?.map((item) => `${item.title}: ${item.detail}`).join(" ");
  openExplanation(explanationPayload(
    "Food logic",
    "Food Logic",
    `${rules} ${suggestions || ""}`.trim(),
    "Nutrition",
  ));
}

function renderAsk() {
  const currentClientId = state.client?.id || "";
  const answer = state.askClientId && state.askClientId === currentClientId ? state.askAnswer : "";
  renderAskAnswer(answer || "Your answer will appear here.");
  els.askSuggestions.replaceChildren();
  askSuggestions(state.blueprint).forEach((question) => {
    const button = document.createElement("button");
    button.className = "suggestion-button";
    button.type = "button";
    button.textContent = question;
    button.addEventListener("click", () => {
      els.askQuestion.value = question;
      setTab("ask");
      els.askQuestion.focus();
    });
    els.askSuggestions.append(button);
  });
}

async function askBlueprintQuestion(event) {
  event.preventDefault();

  const question = els.askQuestion.value.trim();
  if (question.length < 8) {
    setAskStatus("Ask a little more detail so the answer can use your Blueprint.", true);
    return;
  }

  if (!state.session) {
    setAskStatus("Sign in first so the answer can use your Blueprint.", true);
    return;
  }

  const button = els.askForm.querySelector("button");
  button.disabled = true;
  renderAskAnswer("AI is reading your Blueprint context...");
  setAskStatus("Calling Blueprint AI...");
  let requestClientId = "";
  let requestUserId = "";
  let timeoutId = 0;

  try {
    if (!state.client) {
      await syncAll();
    }
    if (!state.client) {
      setAskStatus("Client data is still loading. Tap Refresh and try again.", true);
      return;
    }

    requestClientId = state.client.id;
    requestUserId = state.session.userId;
    const controller = new AbortController();
    timeoutId = window.setTimeout(() => controller.abort(), 20000);
    const response = await fetch(functionUrl("ask-blueprint-question"), {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${state.session.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: requestClientId,
        question,
        profile: state.blueprint.profile?.key || "unknown",
        client_context: buildAskContextSnapshot(),
      }),
      signal: controller.signal,
    });
    window.clearTimeout(timeoutId);
    const data = await parseResponse(response, "Could not answer this question.");
    if (state.client?.id !== requestClientId || state.session?.userId !== requestUserId) return;
    state.askAnswer = data.answer || buildLocalAskAnswer(question);
    state.askClientId = requestClientId;
    renderAskAnswer(state.askAnswer);
    if (data.provider === "Blueprint fallback") {
      setAskStatus("Server answered without an AI provider. Check the MiniMax secret if this should be AI.", true);
    } else {
      setAskStatus(data.provider ? `Answered with ${data.provider}.` : "Answered from Blueprint context.");
    }
  } catch (error) {
    const message = error.name === "AbortError" ? "AI answer took too long." : error.message;
    if (!requestClientId || state.client?.id !== requestClientId || state.session?.userId !== requestUserId) return;
    state.askAnswer = buildLocalAskAnswer(question);
    state.askClientId = state.client.id;
    renderAskAnswer(state.askAnswer);
    setAskStatus(`${message} Showing the Blueprint-based answer for now.`, true);
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
    button.disabled = false;
  }
}

function buildAskContextSnapshot() {
  const blueprint = state.blueprint || {};
  return {
    current_focus: blueprint.currentFocus || "",
    profile: blueprint.profile?.key || "unknown",
    priorities: (blueprint.priorities || []).slice(0, 6),
    food_focus: (blueprint.foodFocus || []).slice(0, 12),
    food_suggestions: (blueprint.foodSuggestions || []).slice(0, 6),
    training_plan: (blueprint.trainingPlan || []).slice(0, 6),
    supplement_ideas: (blueprint.supplementIdeas || []).slice(0, 6),
    dna_insights: blueprint.dnaInsights || {},
    preferred_swaps: preferredFoodSwaps(blueprint.foodFocus || []),
    biomarkers: (blueprint.biomarkers || []).slice(0, 10).map((marker) => ({
      name: marker.name,
      value: marker.value,
      unit: marker.unit,
      range: marker.range,
      reason: marker.reason,
      status: marker.statusTitle,
    })),
    recent_checkins: (state.checkins || []).slice(0, 7),
  };
}

function askSuggestions(blueprint) {
  const food = blueprint.foodFocus?.[0] || "my current food rules";
  const training = blueprint.trainingPlan?.[0]?.title || "today's training";
  return [
    `I am thinking about this breakfast: salmon, avocado and oats. Does it fit my Blueprint?`,
    `Does this meal work with ${food}?`,
    `Should I train hard today or keep ${training} easier?`,
    "Which daily signals should I watch this week?",
  ];
}

function buildLocalAskAnswer(question) {
  const foodRules = state.blueprint.foodFocus?.length
    ? state.blueprint.foodFocus.join("; ")
    : "No specific food rules are loaded yet.";
  const focus = state.blueprint.currentFocus || "Use the Blueprint and daily signals together.";
  const lower = question.toLowerCase();
  const isFood = /breakfast|meal|eat|food|dairy|egg|protein|oats|fish|coffee|alcohol/.test(lower);

  if (isFood) {
    const wantsYoghurt = /yoghurt|yogurt|greek|dairy/.test(lower);
    const yoghurtSwap = wantsYoghurt && /dairy|casein|milk|whey|yoghurt|yogurt|cheese/i.test(foodRules)
      ? " If you want the yoghurt texture, use unsweetened coconut-based yoghurt and keep the protein anchored with the approved protein foods from the Blueprint."
      : "";
    return [
      `Short answer: compare the meal against your loaded food rules first. Current Blueprint food context: ${foodRules}`,
      `How to adjust: keep the protein anchor simple, avoid foods that are marked as temporary avoid/limit items, and change one variable at a time.${yoghurtSwap}`,
      "What to track: energy, gut comfort, cravings, sleep and recovery over the next 24 hours.",
      "Ask LCM if symptoms flare, if you are unsure about an avoided food, or if the meal involves supplements or medication interactions.",
    ].join("\n\n");
  }

  return [
    `Short answer: use this question against your current focus: ${focus}`,
    "How to apply it: keep the protocol stable, look for patterns in check-ins, and avoid changing several inputs at once.",
    "What to track: energy, sleep, gut comfort, recovery, training response and any symptoms that repeat.",
    "Ask LCM before changing medication, adding supplements, making major dietary exclusions, or interpreting abnormal lab values.",
  ].join("\n\n");
}

function renderAskAnswer(text) {
  els.askAnswer.replaceChildren();
  String(text).split(/\n{2,}/).filter(Boolean).forEach((paragraphText) => {
    const paragraph = document.createElement("p");
    appendInlineMarkdown(paragraph, paragraphText.trim());
    els.askAnswer.append(paragraph);
  });
}

function appendInlineMarkdown(element, text) {
  text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).forEach((part) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      const strong = document.createElement("strong");
      strong.textContent = part.slice(2, -2);
      element.append(strong);
      return;
    }
    element.append(document.createTextNode(part));
  });
}

function renderCheckIn() {
  renderList(els.recentCheckins, state.checkins.slice(0, 8), (checkin) => {
    const body = checkin.note || "No written note.";
    return itemCard({
      title: formatDate(checkin.date),
      body,
      badge: `E${checkin.energy} S${checkin.sleep} G${checkin.gut}`,
      footer: `Recovery ${checkin.recovery}/10`,
    });
  }, "No check-ins yet.");
}

function renderTrends() {
  drawChart(state.checkins);
  renderList(els.biomarkerList, state.blueprint.biomarkers, biomarkerCard, "No biomarkers published yet.");
}

function renderProtocol() {
  const blueprint = state.blueprint;
  els.trainingHeadline.textContent = blueprint.trainingHeadline;
  renderList(els.phaseList, blueprint.protocolPhases, phaseCard, "No protocol phases published yet.");
  renderList(els.trainingList, blueprint.trainingPlan, (item) => itemCard({
    title: item.title,
    body: item.detail,
    badge: "Training",
    badgeClass: "training",
    explain: explanationPayload("Training recommendation", item.title, item.detail, "Training"),
  }), "No training recommendations published yet.");
  renderList(els.supplementList, blueprint.supplementIdeas, (item) => itemCard({
    title: item.title,
    body: item.idea,
    badge: item.badge || "Review",
    badgeClass: item.className || layerClass(item.badge || item.title),
    footer: item.note,
    explain: explanationPayload("Supplement idea", item.title, item.idea, item.badge || "Review", item.note),
  }), "No supplement ideas published yet.");
}

function itemCard({ title, body, badge, badgeClass = "", rank = "", footer = "", explain = null }) {
  const card = div("item-card");
  const top = div("item-top");
  const heading = document.createElement("h4");
  heading.textContent = title || "Blueprint item";
  top.append(heading);

  const badgeGroup = div("meta-row");
  if (rank) {
    const rankPill = span("rank-pill", rank);
    badgeGroup.append(rankPill);
  }
  if (badge) {
    badgeGroup.append(span(`pill ${badgeClass}`.trim(), badge));
  }
  if (explain) {
    card.classList.add("explainable");
    card.addEventListener("dblclick", () => openExplanation(explain));
    card.tabIndex = 0;
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter") openExplanation(explain);
    });
  }
  top.append(badgeGroup);
  card.append(top);

  if (body) {
    const paragraph = document.createElement("p");
    paragraph.textContent = body;
    card.append(paragraph);
  }
  if (footer) {
    const next = document.createElement("p");
    next.className = "next-action";
    next.textContent = footer;
    card.append(next);
  }
  if (explain) {
    const explainButton = document.createElement("button");
    explainButton.className = "explain-button";
    explainButton.type = "button";
    explainButton.textContent = "Explain this";
    explainButton.addEventListener("click", (event) => {
      event.stopPropagation();
      openExplanation(explain);
    });
    card.append(explainButton);
  }
  return card;
}

function biomarkerCard(marker) {
  const card = itemCard({
    title: marker.name,
    badge: marker.statusTitle,
    badgeClass: marker.status,
    explain: explanationPayload(
      "Biomarker",
      marker.name,
      `${marker.reason}. Current value: ${marker.value}${marker.unit ? ` ${marker.unit}` : ""}.`,
      marker.statusTitle,
      marker.range,
    ),
  });

  const summary = div("biomarker-summary");
  const valueBlock = div("biomarker-value-block");
  const value = document.createElement("strong");
  value.className = "biomarker-value";
  value.textContent = `${marker.value}${marker.unit ? ` ${marker.unit}` : ""}`;
  valueBlock.append(value, span("biomarker-label", "Tested baseline"));

  const detail = div("biomarker-detail");
  const reason = document.createElement("p");
  reason.className = "biomarker-reason";
  reason.textContent = marker.reason || "Blueprint marker to trend over time.";
  const range = document.createElement("p");
  range.className = "biomarker-range";
  range.textContent = marker.range || "Target context pending.";
  detail.append(reason, range);
  summary.append(valueBlock, detail);

  const baseline = biomarkerBaseline(marker);
  const progress = biomarkerRangeTrack(marker, baseline);
  const explainButton = card.querySelector(".explain-button");
  card.insertBefore(summary, explainButton || null);
  card.insertBefore(progress, explainButton || null);
  if (baseline.caption) {
    const caption = document.createElement("p");
    caption.className = "baseline-caption";
    caption.textContent = baseline.caption;
    card.insertBefore(caption, explainButton || null);
  }
  return card;
}

function phaseCard(phase) {
  const card = itemCard({
    title: phase.title,
    body: "",
    badge: phase.isUnlocked ? "Open" : "Locked",
    footer: phase.week,
    explain: explanationPayload("Protocol phase", phase.title, phase.actions.join(" "), phase.week),
  });
  const list = document.createElement("ul");
  list.className = "phase-list";
  phase.actions.forEach((action) => {
    const item = document.createElement("li");
    item.textContent = action;
    list.append(item);
  });
  card.append(list);
  return card;
}

function renderList(container, rows, renderItem, emptyText = "Nothing to show yet.") {
  container.replaceChildren();
  if (!rows?.length) {
    container.append(itemCard({ title: emptyText, body: "", badge: "Pending" }));
    return;
  }
  rows.forEach((row) => container.append(renderItem(row)));
}

function renderTags(container, tags, onTagClick = null) {
  container.replaceChildren();
  if (!tags?.length) {
    container.append(span("tag", "Pending"));
    return;
  }
  tags.forEach((tag) => {
    if (!onTagClick) {
      container.append(span("tag", tag));
      return;
    }
    const button = document.createElement("button");
    button.className = "tag tag-button";
    button.type = "button";
    button.textContent = tag;
    button.addEventListener("click", () => onTagClick(tag));
    container.append(button);
  });
}

function buildFoodSuggestions(foodFocus, profileKey) {
  const rules = (foodFocus || []).join(" ").toLowerCase();
  const avoid = [];
  if (/dairy|casein|milk|whey|yoghurt|yogurt|cheese/.test(rules)) avoid.push("dairy protein");
  if (/egg white/.test(rules)) avoid.push("egg white");
  if (/soy/.test(rules)) avoid.push("soy");
  if (/almond/.test(rules)) avoid.push("almond");
  const avoidText = avoid.length ? `Avoids ${avoid.join(", ")}.` : "Uses neutral protein anchors from the Blueprint.";
  const femaleNote = profileKey === "female" ? "Useful when cycle symptoms, cravings or luteal recovery need a steadier morning baseline." : "";
  const suggestions = [];

  if (avoid.includes("dairy protein")) {
    suggestions.push({
      title: "Coconut yoghurt breakfast bowl",
      detail: "Unsweetened coconut-based yoghurt with berries, oats, chia or flax if tolerated, plus an approved protein anchor on the side.",
      badge: "Dairy-free",
      note: "Like-for-like swap for Greek yoghurt while dairy protein is temporarily avoided.",
    });
  }

  return suggestions.concat([
    {
      title: "Salmon avocado plate",
      detail: "Smoked salmon or leftover salmon with avocado, cucumber, tomato, olive oil and cooked potatoes or oats on the side if tolerated.",
      badge: "No dairy",
      note: `${avoidText} ${femaleNote}`.trim(),
    },
    {
      title: "Turkey or chicken breakfast bowl",
      detail: "Sliced turkey or chicken with cooked vegetables, olive oil, herbs and a small portion of rice, potato or oats depending on tolerance.",
      badge: "Protein",
      note: "Keeps breakfast high-protein without using dairy or egg white.",
    },
    {
      title: "Sardine or tuna Mediterranean toast bowl",
      detail: "Sardines or tuna with tomato, cucumber, olives, olive oil and gluten-free crackers or potato if bread is not part of the plan.",
      badge: "Omega-3",
      note: "Also supports the Mediterranean lipid strategy and oily fish target.",
    },
    {
      title: "Lentil chickpea protein bowl",
      detail: "Lentils or chickpeas with olive oil, herbs, cooked greens and optional fish or poultry for extra protein.",
      badge: "Fibre",
      note: "Start small if fibre is being ramped gradually.",
    },
    {
      title: "Pea/rice protein smoothie",
      detail: "Pea or rice protein with berries, chia or flax and water or coconut water. Keep it LCM-reviewed if using a powder.",
      badge: "Simple",
      note: "Avoids whey, casein, soy and almond milk.",
    },
  ]);
}

function preferredFoodSwaps(foodFocus) {
  const rules = (foodFocus || []).join(" ").toLowerCase();
  const swaps = [];
  if (/dairy|casein|milk|whey|yoghurt|yogurt|cheese/.test(rules)) {
    swaps.push("Greek/cow dairy yoghurt -> unsweetened coconut-based yoghurt; keep protein anchored elsewhere.");
  }
  if (/egg white/.test(rules)) {
    swaps.push("Egg white -> fish, poultry or another approved protein anchor.");
  }
  return swaps;
}

function biomarkerBaseline(marker) {
  const standard = biomarkerStandard(marker);
  const value = parseNumber(marker.value);
  if (!standard || !Number.isFinite(value)) {
    return {
      position: Math.round((marker.progress || defaultProgress(marker.status)) * 100),
      caption: "Baseline captured from the Blueprint. Numeric standard needs LCM context.",
      standard,
      value,
    };
  }

  const span = standard.max - standard.min;
  const position = clamp(((value - standard.min) / span) * 100, 0, 100);
  const targetStart = clamp(((standard.targetLow - standard.min) / span) * 100, 0, 100);
  const targetEnd = clamp(((standard.targetHigh - standard.min) / span) * 100, 0, 100);
  const deviation = value < standard.targetLow
    ? `${formatNumber(standard.targetLow - value)} below target`
    : value > standard.targetHigh
      ? `${formatNumber(value - standard.targetHigh)} above target`
      : "inside target zone";

  return {
    position,
    targetStart,
    targetEnd,
    caption: `Baseline ${formatNumber(value)} ${marker.unit || standard.unit}; ${deviation}. Target ${standard.label}.`,
    standard,
    value,
  };
}

function biomarkerRangeTrack(marker, baseline) {
  const track = div("baseline-track");
  const label = div("baseline-labels");
  const low = document.createElement("span");
  const high = document.createElement("span");
  low.textContent = baseline.standard ? `${formatNumber(baseline.standard.min)}` : "Low";
  high.textContent = baseline.standard ? `${formatNumber(baseline.standard.max)}` : "High";
  label.append(low, high);

  const rail = div("baseline-rail");
  if (baseline.standard) {
    const target = div("target-zone");
    target.style.left = `${baseline.targetStart}%`;
    target.style.width = `${Math.max(3, baseline.targetEnd - baseline.targetStart)}%`;
    rail.append(target);
  }

  const dot = div(`baseline-dot ${marker.status}`);
  dot.style.left = `${baseline.position}%`;
  dot.title = "Baseline value";
  rail.append(dot);

  const meta = div("baseline-meta");
  const baselineText = document.createElement("span");
  baselineText.textContent = "Baseline";
  const targetText = document.createElement("span");
  targetText.textContent = baseline.standard ? `Target ${baseline.standard.label}` : "Target: review";
  meta.append(baselineText, targetText);
  track.append(label, rail, meta);
  return track;
}

function biomarkerStandard(marker) {
  const name = marker.name.toLowerCase();
  const profile = state.blueprint.profile?.key || "unknown";
  if (name.includes("ferritin")) return { min: 0, max: 150, targetLow: profile === "female" ? 45 : 50, targetHigh: 100, label: profile === "female" ? "45-100" : "50-100", unit: marker.unit };
  if (name.includes("vitamin d")) return { min: 10, max: 90, targetLow: 40, targetHigh: 60, label: "40-60", unit: marker.unit };
  if (name.includes("ldl")) return { min: 50, max: 190, targetLow: 50, targetHigh: 100, label: "<100", unit: marker.unit };
  if (name.includes("apob") || name.includes("apo b")) return { min: 40, max: 140, targetLow: 40, targetHigh: 80, label: "<80", unit: marker.unit };
  if (name.includes("hba1c")) return { min: 4.5, max: 6.5, targetLow: 4.8, targetHigh: 5.3, label: "4.8-5.3", unit: marker.unit };
  if (name.includes("insulin")) return { min: 2, max: 20, targetLow: 2, targetHigh: 6, label: "2-6", unit: marker.unit };
  if (name.includes("hscrp") || name.includes("hs-crp")) return { min: 0, max: 5, targetLow: 0, targetHigh: 1, label: "<1.0", unit: marker.unit };
  if (name === "tsh" || name.includes("thyroid")) return { min: 0.5, max: 5, targetLow: 0.8, targetHigh: 2.5, label: "0.8-2.5", unit: marker.unit };
  if (name.includes("calprotectin")) return { min: 0, max: 150, targetLow: 0, targetHigh: 50, label: "<50", unit: marker.unit };
  if (name.includes("alt")) return { min: 5, max: 70, targetLow: 10, targetHigh: 35, label: "10-35", unit: marker.unit };
  return null;
}

function explanationPayload(type, title, body, badge = "", footer = "") {
  return {
    clientId: state.client?.id || "",
    profile: state.blueprint.profile?.key || "unknown",
    currentFocus: state.blueprint.currentFocus || "",
    type,
    title,
    body,
    badge,
    footer,
  };
}

async function openExplanation(payload) {
  els.explainKicker.textContent = `${payload.type}${payload.badge ? ` · ${payload.badge}` : ""}`;
  els.explainTitle.textContent = payload.title || "Blueprint theme";
  renderExplanation(buildBlueprintExplanation(payload));
  els.explainStatus.textContent = "Blueprint-based explanation.";
  els.explainSheet.hidden = false;

  const aiExplanation = await fetchAiExplanation(payload).catch(() => "");
  if (aiExplanation) {
    renderExplanation(aiExplanation);
    els.explainStatus.textContent = "AI explanation based on this Blueprint theme.";
  }
}

function closeExplanation() {
  els.explainSheet.hidden = true;
}

async function fetchAiExplanation(payload) {
  if (!state.session || !state.client) return "";
  const response = await fetch(functionUrl("explain-blueprint-theme"), {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${state.session.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: state.client.id,
      profile: payload.profile,
      current_focus: payload.currentFocus,
      theme: {
        type: payload.type,
        title: payload.title,
        body: payload.body,
        badge: payload.badge,
        footer: payload.footer,
      },
    }),
  });
  if (!response.ok) return "";
  const data = await response.json();
  return typeof data.explanation === "string" ? data.explanation : "";
}

function buildBlueprintExplanation(payload) {
  const profileContext = payload.profile === "female"
    ? "In this female Blueprint, interpret this together with cycle phase, iron status, sleep, gut comfort and recovery."
    : payload.profile === "male"
      ? "In this male Blueprint, interpret this together with sleep, training load, body composition, metabolic risk and hormone context."
      : "Interpret this together with the full Blueprint, daily signals and follow-up testing.";
  const source = [payload.body, payload.footer].filter(Boolean).join(" ");
  return [
    `What it means: ${source || payload.title}`,
    `Why it matters: this theme can change how energy, recovery, symptoms or retest priorities are interpreted over the next protocol block.`,
    `How to use it this week: connect it to your daily check-ins instead of changing several things at once.`,
    `Personal context: ${profileContext}`,
    "Boundary: this is coaching context from your Blueprint, not a diagnosis or medication/supplement prescription.",
  ].join("\n\n");
}

function renderExplanation(text) {
  els.explainBody.replaceChildren();
  String(text).split(/\n{2,}/).filter(Boolean).forEach((paragraphText) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = paragraphText.trim();
    els.explainBody.append(paragraph);
  });
}

function drawChart(checkins) {
  const svg = els.signalsChart;
  svg.replaceChildren();
  const sorted = [...checkins].slice(0, 14).reverse();
  const width = 320;
  const height = 180;
  const pad = 22;
  const plotW = width - pad * 2;
  const plotH = height - pad * 2;

  appendSvg(svg, "line", { x1: pad, y1: pad, x2: pad, y2: height - pad, class: "chart-axis" });
  appendSvg(svg, "line", { x1: pad, y1: height - pad, x2: width - pad, y2: height - pad, class: "chart-axis" });

  if (sorted.length < 2) {
    const text = appendSvg(svg, "text", { x: width / 2, y: height / 2, "text-anchor": "middle", fill: "#aab3a5" });
    text.textContent = "Add two check-ins to see trends.";
    return;
  }

  const metrics = [
    ["energy", "#d1b078", "Energy"],
    ["sleep", "#7eade8", "Sleep"],
    ["gut", "#61c88f", "Gut"],
  ];
  metrics.forEach(([key, color]) => {
    const points = sorted.map((row, index) => {
      const x = pad + (plotW * index) / Math.max(sorted.length - 1, 1);
      const y = height - pad - (plotH * Number(row[key] || 0)) / 10;
      return [x, y];
    });
    appendSvg(svg, "path", {
      d: `M ${points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L ")}`,
      class: "chart-line",
      stroke: color,
    });
    points.forEach(([x, y]) => appendSvg(svg, "circle", {
      cx: x,
      cy: y,
      r: 3.5,
      fill: color,
      class: "chart-dot",
    }));
  });
}

function blueprintFromReport(report, fallbackClientName) {
  const summary = objectOrEmpty(report.summary_json);
  const protocol = objectOrEmpty(report.protocol_json);
  const clientName = pick(summary, ["client_name", "clientName"]) || fallbackClientName || "Client";
  const profileKey = detectBiologyProfile(summary, protocol, report);
  const profile = biologyProfile(profileKey);
  const priorities = mapPriorities(firstArray(summary, ["priorities", "primary_priorities", "primaryPriorities"]));
  const dnaInsights = extractDnaInsights(summary, protocol);
  const layers = ensureDnaLayer(mapLayers(priorities), dnaInsights);
  const protocolPhases = mapProtocolPhases(firstArray(protocol, ["phases", "protocol_phases", "protocolPhases"]));
  const trainingPlan = mapTraining(firstArray(summary, ["training", "training_plan", "trainingPlan"])).length
    ? mapTraining(firstArray(summary, ["training", "training_plan", "trainingPlan"]))
    : mapTraining(firstArray(protocol, ["training", "training_plan", "trainingPlan"]));
  const extractedSupplements = mapSupplements(firstArray(summary, ["supplements", "supplement_ideas", "supplementIdeas"])).length
    ? mapSupplements(firstArray(summary, ["supplements", "supplement_ideas", "supplementIdeas"]))
    : mapSupplements(firstArray(protocol, ["supplements", "supplement_ideas", "supplementIdeas"]));
  const foodRuleKeys = ["food_focus", "foodFocus", "nutrition", "food_rules", "foodRules"];
  const foodAvoidKeys = ["sensitive_foods", "sensitiveFoods", "avoid_foods", "avoidFoods", "foods_to_avoid", "foodsToAvoid", "food_sensitivities", "foodSensitivities"];
  const foodFocus = textArray(firstArray(summary, foodRuleKeys))
    .concat(textArray(firstArray(summary, foodAvoidKeys)).map((food) => `Avoid ${food}`))
    .concat(textArray(firstArray(protocol, foodRuleKeys)))
    .concat(textArray(firstArray(protocol, foodAvoidKeys)).map((food) => `Avoid ${food}`))
    .filter(unique);
  const safetyNotes = textArray(firstArray(summary, ["safety_notes", "safetyNotes", "cautions"]))
    .concat(textArray(firstArray(protocol, ["safety_notes", "safetyNotes"])))
    .filter(unique);
  const biomarkers = mapBiomarkers(firstArray(summary, ["biomarkers", "blood_markers", "lab_results"]));
  const foodSuggestions = buildFoodSuggestions(foodFocus, profile.key);
  const supplementIdeas = withDnaSupplementIdeas(extractedSupplements, dnaInsights);
  const focus = meaningfulFocus(report.current_focus)
    || meaningfulFocus(pick(summary, ["headline", "current_focus", "currentFocus"]))
    || (priorities[0] ? `${priorities[0].layer}: ${priorities[0].title}` : "");
  const pending = pendingBlueprint(clientName);

  return {
    clientName,
    profile,
    reportDate: report.delivered_at || "",
    currentFocus: focus || pending.currentFocus,
    message: focus || priorities.length ? "Your reviewed Blueprint is loaded." : "LCM has published this Blueprint, but extraction data is still pending.",
    todayPlan: buildTodayPlan(priorities, foodFocus, trainingPlan, protocolPhases),
    priorities,
    layers,
    protocolPhases,
    trainingPlan,
    trainingHeadline: trainingPlan[0]?.title || "Blueprint training recommendations.",
    supplementIdeas,
    dnaInsights,
    biomarkers,
    foodFocus,
    foodSuggestions,
    safetyNotes: safetyNotes.length ? safetyNotes : pending.safetyNotes,
  };
}

function pendingBlueprint(clientName) {
  return {
    clientName,
    profile: biologyProfile("unknown"),
    reportDate: "",
    currentFocus: "Your Blueprint will appear here after LCM publishes the report.",
    message: "Daily check-ins can still be saved while the report is pending.",
    todayPlan: [
      { title: "Blueprint pending", detail: "LCM has not published the extracted protocol data for this client yet.", layer: "Pending" },
      { title: "Daily check-in", detail: "Track energy, sleep, gut comfort and recovery.", layer: "Check-in" },
    ],
    priorities: [],
    layers: [],
    protocolPhases: [],
    trainingPlan: [],
    trainingHeadline: "Training recommendations will appear after extraction.",
    supplementIdeas: [],
    dnaInsights: extractDnaInsights({}, {}),
    biomarkers: [],
    foodFocus: [],
    foodSuggestions: [],
    safetyNotes: ["This app supports coaching and tracking; it does not replace medical diagnosis."],
  };
}

function detectBiologyProfile(summary, protocol, report) {
  const explicit = [
    pick(summary, ["biology_profile", "biologyProfile", "sex", "gender", "profile"]),
    pick(protocol, ["biology_profile", "biologyProfile", "sex", "gender", "profile"]),
    pick(summary, ["package", "package_name", "packageName"]),
  ].join(" ").toLowerCase();
  if (/\bfemale\b|woman|women|perimenopause|menopause|cycling/.test(explicit)) return "female";
  if (/\bmale\b|man|men\b|prostate|psa|andropause/.test(explicit)) return "male";

  const haystack = JSON.stringify({ summary, protocol, focus: report.current_focus || "" }).toLowerCase();
  const femaleScore = [
    "female",
    "cycle",
    "cycling",
    "luteal",
    "follicular",
    "perimenopause",
    "menopause",
    "progesterone",
    "estradiol",
    "pms",
    "hrt",
    "menstruating",
    "shbg",
  ].reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
  const maleScore = [
    "male",
    "testosterone",
    "prostate",
    "psa",
    "dht",
    "andropause",
    "sperm",
    "erectile",
    "libido",
    "visceral fat",
  ].reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);

  if (femaleScore >= 2 && femaleScore >= maleScore) return "female";
  if (maleScore >= 2 && maleScore > femaleScore) return "male";
  return "unknown";
}

function biologyProfile(key) {
  if (key === "female") {
    return {
      key,
      label: "Female biology lens",
      title: "Cycle, iron, DNA, recovery and transition context",
      copy: "This dashboard treats hormones, genetics, energy and training as phase-sensitive rather than static scores.",
      items: [
        { title: "Cycle-aware recovery", detail: "Track cycle phase, sleep dips, PMS and training tolerance together.", badge: "Recovery", className: "recovery" },
        { title: "Iron and energy resilience", detail: "Ferritin, CBC, bleeding pattern and fatigue should be reviewed as one layer.", badge: "Blood", className: "blood" },
        { title: "DNA and methylation context", detail: "Use genetic findings as context for nutrient needs, detox capacity and inflammation patterns when present.", badge: "DNA", className: "dna" },
        { title: "Gut and estrogen clearance", detail: "Bowel rhythm, fibre ramp and food tolerance influence PMS, bloating and skin signals.", badge: "Gut", className: "gut" },
        { title: "Midlife prevention", detail: "ApoB, LDL, glucose, muscle and bone strength deserve early trend tracking.", badge: "Blood", className: "blood" },
      ],
    };
  }

  if (key === "male") {
    return {
      key,
      label: "Male biology lens",
      title: "Performance, DNA, metabolic risk and hormone context",
      copy: "This dashboard reads genetics, testosterone, recovery, cardiometabolic risk and training load together.",
      items: [
        { title: "Testosterone in context", detail: "Free testosterone, SHBG, sleep, alcohol, stress and body composition should be interpreted together.", badge: "Hormones", className: "recovery" },
        { title: "Cardiometabolic prevention", detail: "ApoB, LDL, insulin, HbA1c, blood pressure and waist trend are core operating metrics.", badge: "Blood", className: "blood" },
        { title: "DNA and methylation context", detail: "Use genetic findings as context for nutrient needs, detox capacity and inflammation patterns when present.", badge: "DNA", className: "dna" },
        { title: "Training capacity", detail: "Strength, Zone 2 and mobility build output without stacking intensity on poor recovery.", badge: "Training", className: "training" },
        { title: "Prostate and inflammation context", detail: "PSA, urinary symptoms, hsCRP and liver markers should stay in the review layer when present.", badge: "Review", className: "dna" },
      ],
    };
  }

  return {
    key: "unknown",
    label: "Blueprint biology lens",
    title: "Personal context from the report",
    copy: "The dashboard adapts when the Blueprint profile and DNA context are available in the extracted data.",
    items: [
      { title: "Blood and biomarkers", detail: "Use the report markers as the starting point for trend tracking.", badge: "Blood", className: "blood" },
      { title: "DNA and genetics", detail: "Use the DNA layer as context for nutrient needs, detox capacity, inflammation and recovery patterns when present.", badge: "DNA", className: "dna" },
      { title: "Gut, food and recovery", detail: "Connect daily symptoms with nutrition, training and sleep signals.", badge: "Protocol", className: "gut" },
    ],
  };
}

function notePlaceholder(profileKey) {
  if (profileKey === "female") return "Symptoms, meals, training, travel, cycle phase, PMS, sleep...";
  if (profileKey === "male") return "Symptoms, meals, training, sleep, stress, libido, recovery...";
  return "Symptoms, meals, training, travel, recovery...";
}

function mapPriorities(rows) {
  return rows.map((row, index) => {
    const layer = pick(row, ["layer", "category"]) || "Blueprint";
    return {
      rank: normalizeRank(pick(row, ["rank"]), index),
      layer,
      title: pick(row, ["title", "name", "focus", "what_we_found", "whatWeFound", "finding"]) || "Blueprint priority",
      why: pick(row, ["why", "reason", "signal", "why_it_matters", "whyItMatters", "interpretation"]) || "Important signal from the uploaded Blueprint.",
      nextAction: pick(row, ["next_action", "nextAction", "action", "first_decision", "firstDecision", "decision", "recommendation"]) || "Discuss this in the next LCM review.",
    };
  });
}

function mapLayers(priorities) {
  const seen = new Set();
  return priorities.filter((priority) => {
    const key = priority.layer.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((priority, index) => ({
    name: priority.layer,
    signal: priority.why,
    decision: priority.nextAction,
    status: index === 0 ? "Priority" : "Active",
  }));
}

function ensureDnaLayer(layers, dnaInsights) {
  const hasDna = layers.some((layer) => /dna|gene|genetic|methyl/i.test(layer.name));
  if (hasDna) return layers;
  return [
    ...layers,
    {
      name: "DNA and genetics",
      signal: dnaInsights.signal,
      decision: dnaInsights.decision,
      status: dnaInsights.hasReportSignal ? "Active" : "Context",
    },
  ];
}

function extractDnaInsights(summary, protocol) {
  const dnaRows = [
    ...firstArray(summary, ["dna", "genetics", "genetic_findings", "geneticFindings", "methylation", "nutrigenomics"]),
    ...firstArray(protocol, ["dna", "genetics", "genetic_findings", "geneticFindings", "methylation", "nutrigenomics"]),
  ];
  const text = textArray(dnaRows).filter(unique).join("; ");
  return {
    hasReportSignal: Boolean(text),
    signal: text || "Use DNA context alongside blood markers, symptoms and check-ins rather than as a stand-alone score.",
    decision: text
      ? "Translate DNA findings into food, supplement and recovery choices only after LCM review."
      : "Use this layer for supplement review, methylation context, detox capacity and inflammation patterns when DNA data is available.",
  };
}

function withDnaSupplementIdeas(items, dnaInsights) {
  const hasDnaItem = items.some((item) => /dna|gene|genetic|methyl/i.test(`${item.title} ${item.idea} ${item.note}`));
  if (hasDnaItem) return items;
  return [
    ...items,
    {
      title: "DNA-informed methylation review",
      idea: "Use DNA findings together with homocysteine, B12, folate, B6, energy and mood signals before choosing methylation support.",
      note: "Review with LCM before adding methylated B vitamins or changing dose.",
      badge: "DNA",
      className: "dna",
    },
    {
      title: "DNA detox and inflammation support review",
      idea: "Connect genetic detox and inflammation context with omega-3, magnesium, NAC or glutathione-style support only when the Blueprint and blood markers support it.",
      note: dnaInsights.hasReportSignal ? dnaInsights.decision : "Use as a review prompt, not a blind supplement stack.",
      badge: "DNA",
      className: "dna",
    },
  ];
}

function mapProtocolPhases(rows) {
  return rows.map((row, index) => ({
    week: pick(row, ["week", "weeks", "phase", "current_phase", "currentPhase"]) || `Week ${index + 1}`,
    title: pick(row, ["title", "focus"]) || "Protocol phase",
    actions: textArray(firstArray(row, ["actions", "steps", "recommendations"])).length
      ? textArray(firstArray(row, ["actions", "steps", "recommendations"]))
      : ["Review this phase with LCM."],
    isUnlocked: Boolean(row.is_unlocked ?? row.isUnlocked ?? index < 2),
  }));
}

function mapTraining(rows) {
  return rows.map((row) => ({
    title: pick(row, ["title", "name"]) || "Training recommendation",
    detail: pick(row, ["detail", "description", "why", "action", "recommendation"]) || "Follow the reviewed Blueprint training recommendation.",
  }));
}

function mapSupplements(rows) {
  return rows.map((row) => {
    const title = pick(row, ["title", "name"]) || "Supplement review item";
    const badge = pick(row, ["badge", "layer", "category"]) || (/dna|gene|genetic|methyl/i.test(title) ? "DNA" : "Review");
    return {
      title,
      idea: pick(row, ["idea", "detail", "description", "action", "recommendation"]) || "Review this support idea with LCM before changing the protocol.",
      note: pick(row, ["note", "caution"]) || "Review with LCM before changing the protocol.",
      badge,
      className: layerClass(badge),
    };
  });
}

function mapBiomarkers(rows) {
  return rows.map((row) => {
    const status = markerStatus(pick(row, ["status"]));
    return {
      name: pick(row, ["name", "marker", "marker_name", "markerName"]) || "Marker",
      value: pick(row, ["value", "result"]) || "-",
      unit: pick(row, ["unit", "units"]) || "",
      range: pick(row, ["range", "target", "reference_range", "referenceRange"]) || "Review with LCM",
      reason: pick(row, ["reason", "why", "interpretation"]) || "Blueprint marker",
      status,
      statusTitle: status === "watch" ? "Watch" : status === "improve" ? "Improve" : "Context",
      progress: Number(row.progress) || defaultProgress(status),
    };
  });
}

function buildTodayPlan(priorities, foodFocus, trainingPlan, phases) {
  const actions = [];
  if (priorities[0]) {
    actions.push({ title: "Morning focus", detail: priorities[0].nextAction, layer: priorities[0].layer });
  }
  if (foodFocus[0]) {
    actions.push({ title: "Food focus", detail: foodFocus[0], layer: "Food" });
  }
  if (trainingPlan[0]) {
    actions.push({ title: trainingPlan[0].title, detail: trainingPlan[0].detail, layer: "Training" });
  }
  if (phases[0]?.actions?.[0]) {
    actions.push({ title: "Protocol step", detail: phases[0].actions[0], layer: "Protocol" });
  }
  actions.push({ title: "Evening note", detail: "Track energy, sleep, gut comfort, recovery and anything that changed today.", layer: "Check-in" });
  return actions.slice(0, 4);
}

function firstArray(source, keys) {
  const object = objectOrEmpty(source);
  for (const key of keys) {
    if (Array.isArray(object[key])) return object[key];
  }
  return Array.isArray(source) ? source : [];
}

function textArray(values) {
  return (Array.isArray(values) ? values : []).map((value) => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (value && typeof value === "object") {
      return pick(value, ["title", "name", "label", "action", "detail", "description", "food"]);
    }
    return "";
  }).filter(Boolean);
}

function pick(object, keys) {
  if (!object || typeof object !== "object") return "";
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return "";
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function meaningfulFocus(value) {
  if (!value || typeof value !== "string") return "";
  const text = value.trim();
  const lower = text.toLowerCase();
  if (["your blueprint is ready.", "your blueprint is ready", "blueprint extracted"].includes(lower)) return "";
  return text;
}

function normalizeRank(value, index) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number < 10 ? `0${number}` : String(number);
  return value || (index + 1 < 10 ? `0${index + 1}` : String(index + 1));
}

function markerStatus(value = "") {
  const text = String(value).toLowerCase();
  if (text.includes("watch")) return "watch";
  if (text.includes("improve") || text.includes("low") || text.includes("high")) return "improve";
  return "context";
}

function defaultProgress(status) {
  if (status === "watch") return 0.72;
  if (status === "improve") return 0.48;
  return 0.56;
}

function layerClass(layer = "") {
  const text = layer.toLowerCase();
  if (text.includes("blood") || text.includes("lab")) return "blood";
  if (text.includes("dna") || text.includes("gene")) return "dna";
  if (text.includes("gut")) return "gut";
  if (text.includes("food") || text.includes("nutrition")) return "food";
  if (text.includes("train") || text.includes("movement")) return "training";
  if (text.includes("recover") || text.includes("sleep") || text.includes("hormone")) return "recovery";
  return "";
}

function colorForStatus(status) {
  if (status === "watch") return "#e65a4b";
  if (status === "improve") return "#d1b078";
  return "#7eade8";
}

function parseNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return Number.NaN;
  const match = value.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : Number.NaN;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "-";
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function setSyncStatus(message) {
  els.syncStatus.textContent = message;
}

function setLoginStatus(message, isError = false) {
  els.loginStatus.textContent = message;
  els.loginStatus.classList.toggle("error", isError);
}

function setCheckinStatus(message, isError = false) {
  els.checkinStatus.textContent = message;
  els.checkinStatus.classList.toggle("error", isError);
}

function setLabStatus(message, isError = false) {
  els.labStatus.textContent = message;
  els.labStatus.classList.toggle("error", isError);
}

function setAskStatus(message, isError = false) {
  els.askStatus.textContent = message;
  els.askStatus.classList.toggle("error", isError);
}

function div(className) {
  const element = document.createElement("div");
  element.className = className;
  return element;
}

function span(className, text) {
  const element = document.createElement("span");
  element.className = className;
  element.textContent = text;
  return element;
}

function appendSvg(parent, tag, attrs) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  parent.append(element);
  return element;
}

function todayIso() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function formatDate(date) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function encodeStoragePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function functionUrl(name) {
  return `${SUPABASE_URL}/functions/v1/${name}?apikey=${encodeURIComponent(SUPABASE_ANON_KEY)}`;
}

function randomId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (char) => (
    Number(char) ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> Number(char) / 4
  ).toString(16));
}

function decodeUserId(token) {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload)).sub || "";
  } catch {
    return "";
  }
}

function unique(value, index, array) {
  return value && array.indexOf(value) === index;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (!location.protocol.startsWith("http")) return;
  navigator.serviceWorker.register("./service-worker.js").catch(() => {});
}

function handleBeforeInstallPrompt(event) {
  event.preventDefault();
  state.installPromptEvent = event;
  updateInstallShortcutVisibility();
  maybeShowInstallPrompt();
}

function showInstallInstructions() {
  maybeShowInstallPrompt({ force: true });
}

function maybeShowInstallPrompt(options = {}) {
  const force = Boolean(options.force);
  if (!els.installPrompt || isStandaloneMode()) return;
  if (!force && (!isMobileDevice() || wasInstallPromptDismissedRecently())) return;

  const isIos = isIosDevice();
  els.installAction.hidden = false;
  els.installSteps.replaceChildren();
  if (state.installPromptEvent && !isIos) {
    els.installCopy.textContent = "Install it once, then open it from your home screen like a normal app.";
    ["Tap Add to Home Screen.", "Open Your Blueprint from the new home screen icon."].forEach((step) => {
      const item = document.createElement("li");
      item.textContent = step;
      els.installSteps.append(item);
    });
    els.installAction.textContent = "Add to Home Screen";
  } else if (isIos) {
    els.installCopy.textContent = "Save this secure web app to your iPhone home screen.";
    ["Tap the Share button in Safari.", "Choose Add to Home Screen.", "Open Your Blueprint from the new icon."].forEach((step) => {
      const item = document.createElement("li");
      item.textContent = step;
      els.installSteps.append(item);
    });
    els.installAction.textContent = "Got it";
  } else {
    els.installCopy.textContent = "Save this page to your phone home screen from your browser menu.";
    ["Open the browser menu.", "Choose Add to Home Screen or Install app.", "Open Your Blueprint from the new icon."].forEach((step) => {
      const item = document.createElement("li");
      item.textContent = step;
      els.installSteps.append(item);
    });
    els.installAction.textContent = "Got it";
  }
  els.installPrompt.hidden = false;
}

async function installApp() {
  if (state.installPromptEvent && !isIosDevice()) {
    state.installPromptEvent.prompt();
    await state.installPromptEvent.userChoice.catch(() => null);
    state.installPromptEvent = null;
  }
  dismissInstallPrompt();
}

function dismissInstallPrompt() {
  storageWrite(INSTALL_DISMISSED_KEY, String(Date.now()));
  hideInstallPrompt();
}

function hideInstallPrompt() {
  if (els.installPrompt) els.installPrompt.hidden = true;
  updateInstallShortcutVisibility();
}

function updateInstallShortcutVisibility() {
  if (!els.installShortcut) return;
  els.installShortcut.hidden = isStandaloneMode();
}

function isMobileDevice() {
  return matchMedia("(max-width: 820px)").matches && (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || isIpadDesktopMode());
}

function isIosDevice() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || isIpadDesktopMode();
}

function isIpadDesktopMode() {
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

function isStandaloneMode() {
  return window.navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
}

function wasInstallPromptDismissedRecently() {
  const dismissedAt = Number(storageRead(INSTALL_DISMISSED_KEY) || 0);
  if (!dismissedAt) return false;
  const fourteenDays = 14 * 24 * 60 * 60 * 1000;
  return Date.now() - dismissedAt < fourteenDays;
}

function storageRead(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return "";
  }
}

function storageWrite(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Some file:// previews block localStorage. The app still works for the current session.
  }
}

function storageRemove(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage restrictions in local file previews.
  }
}
