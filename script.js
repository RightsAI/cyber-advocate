const SESSION_KEY = "rights.session";
const DA_MAX = 82.85;
const TAS_CAP = 0.3;
const FTC_FIRST = 151.91;
const FTC_NEXT = 123.78;

const AS_MAX = {
  single: { 1: 165, 2: 105, 3: 80, 4: 70 },
  sole1: { 1: 235, 2: 155, 3: 105, 4: 80 },
  sole2: { 1: 305, 2: 220, 3: 160, 4: 120 },
  couple: { 1: 235, 2: 155, 3: 105, 4: 80 },
  coupleKids: { 1: 305, 2: 220, 3: 160, 4: 120 },
};

const AS_ENTRY_RENT = {
  single: 93,
  couple: 158,
  sole: 168,
  coupleKids: 205,
};

const AS_INCOME_CUT = {
  single: 693,
  sole: 906,
  couple: 1066,
  coupleKids: 1117,
};

const CHANNEL_LABEL = {
  employment: "CH-01 Employment",
  tenancy: "CH-02 Tenancy",
  family: "CH-03 Family",
  police: "CH-04 Police & courts",
  consumer: "CH-05 Consumer",
  welfare: "CH-06 Benefits & ACC",
};

function money(n) {
  return n.toLocaleString("en-NZ", { style: "currency", currency: "NZD" });
}

function n(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function newSessionId() {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `NZ-${stamp}-${rand}`;
}

function persistSession(patch) {
  const current = readSession();
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...current, ...patch }));
}

function readSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "{}");
  } catch {
    return {};
  }
}

function wipeSessionStore() {
  sessionStorage.clear();
}

function tickClock() {
  const node = document.getElementById("hud-clock");
  if (!node) return;
  node.textContent = new Date().toLocaleTimeString("en-NZ", { hour12: false });
}

function householdOf(partner, children) {
  if (partner) return children > 0 ? "coupleKids" : "couple";
  if (children === 1) return "sole1";
  if (children >= 2) return "sole2";
  return "single";
}

function asEntryKey(kind) {
  if (kind === "sole1" || kind === "sole2") return "sole";
  return kind;
}

function familyTaxCredit(children) {
  if (children <= 0) return 0;
  return FTC_FIRST + FTC_NEXT * (children - 1);
}

function standardCosts(kind, children) {
  if (kind === "single") return 168.05;
  if (kind === "couple") return 315.3;
  return 0.7 * ((kind === "coupleKids" ? 669.4 : 521.52) + familyTaxCredit(children));
}

function tasUpperLimit(kind) {
  const benefit = {
    single: 372.55,
    couple: 633.94,
    coupleKids: 669.4,
    sole1: 521.52,
    sole2: 521.52,
  }[kind];
  return benefit * TAS_CAP;
}

function daIncomeLimit(kind) {
  if (kind === "single") return 870;
  if (kind === "couple" || kind === "coupleKids") return 1295.11;
  if (kind === "sole1") return 971.51;
  return 1023.59;
}

function assetLimit(kind) {
  return kind === "single" ? 8100 : 16200;
}

function estimateExtraHelp(input) {
  const children = Math.max(0, Math.floor(n(input.children)));
  const kind = householdOf(input.partner, children);
  const area = String(input.area || "1");
  const rent = Math.max(0, n(input.rent));
  const income = Math.max(0, n(input.income));
  const assets = Math.max(0, n(input.assets));
  const disabilityCosts = Math.max(0, n(input.disabilityCosts));
  const otherCosts = Math.max(0, n(input.otherCosts));
  const notes = [];

  let asAmount = 0;
  let asNote = "70% of rent above the entry threshold, capped by area.";
  if (input.publicHousing) {
    asNote = "Public housing: Accommodation Supplement is not payable.";
  } else if (assets > assetLimit(kind)) {
    asNote = `Cash assets exceed the ${money(assetLimit(kind))} diagnostic limit.`;
  } else {
    const excess = Math.max(0, rent - AS_ENTRY_RENT[asEntryKey(kind)]);
    const raw = excess * 0.7;
    const capped = Math.min(raw, AS_MAX[kind][area]);
    if (!input.onBenefit) {
      const abate = Math.max(0, income - AS_INCOME_CUT[asEntryKey(kind)]) * 0.25;
      asAmount = Math.max(0, capped - abate);
      if (abate > 0) asNote = "Non-beneficiary income abatement applied at 25c per $1.";
    } else {
      asAmount = capped;
    }
    if (excess <= 0) asNote = "Rent is at or below the entry threshold.";
  }

  let daAmount = 0;
  let daNote = "No disability costs entered.";
  if (disabilityCosts <= 0) {
    daAmount = 0;
  } else if (income > daIncomeLimit(kind)) {
    daNote = `Income is above the DA cut-out (${money(daIncomeLimit(kind))}/wk).`;
  } else {
    daAmount = Math.min(disabilityCosts, DA_MAX);
    daNote =
      daAmount === DA_MAX
        ? `Capped at the standard DA maximum of ${money(DA_MAX)}.`
        : "Payable at verified extra disability costs.";
  }

  const allowable =
    Math.max(0, rent - asAmount) + Math.max(0, disabilityCosts - daAmount) + otherCosts;
  const disposable = income + asAmount + daAmount - standardCosts(kind, children);
  const deficiency = allowable - disposable;
  const cap = tasUpperLimit(kind);
  const tasAmount = Math.max(0, Math.min(deficiency, cap));
  let tasNote = `Deficiency ${money(Math.max(0, deficiency))} · upper limit ${money(cap)} (30% of analogue benefit).`;
  if (deficiency <= 0) tasNote = "No income deficiency after standard costs and extra help.";

  notes.push(asNote, daNote, tasNote);
  return {
    asAmount: round2(asAmount),
    daAmount: round2(daAmount),
    tasAmount: round2(tasAmount),
    total: round2(asAmount + daAmount + tasAmount),
    asNote,
    daNote,
    tasNote,
    kind,
    notes,
  };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function readIntakeFields() {
  return {
    partner: document.getElementById("field-partner")?.value === "yes",
    children: n(document.getElementById("field-children")?.value),
    area: document.getElementById("field-area")?.value || "1",
    onBenefit: document.getElementById("field-benefit")?.value === "yes",
    publicHousing: document.getElementById("field-housing")?.value === "yes",
    assets: n(document.getElementById("field-assets")?.value),
    rent: n(document.getElementById("field-rent")?.value),
    income: n(document.getElementById("field-income")?.value),
    disabilityCosts: n(document.getElementById("field-disability")?.value),
    otherCosts: n(document.getElementById("field-other")?.value),
    msdNotice: document.getElementById("field-notice")?.value || "",
  };
}

function renderEstimate() {
  const result = estimateExtraHelp(readIntakeFields());
  setText("out-as", money(result.asAmount));
  setText("out-da", money(result.daAmount));
  setText("out-tas", money(result.tasAmount));
  setText("out-total", money(result.total));
  setText("note-as", result.asNote);
  setText("note-da", result.daNote);
  setText("note-tas", result.tasNote);
  flagNotice(readIntakeFields().msdNotice);
  return result;
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function flagNotice(text) {
  const flag = document.getElementById("notice-flag");
  if (!flag) return;
  const hit = (text || "").match(/sanction|overpayment|review|decline|suspen|stand.?down|obligation fail/i);
  if (!hit) {
    flag.hidden = true;
    flag.textContent = "";
    return;
  }
  flag.hidden = false;
  flag.textContent = `Notice scan: “${hit[0]}” detected. Raise review/challenge paths in the next module.`;
}

function showModule2(channel, animate) {
  const flow = document.getElementById("flow");
  const m1 = document.getElementById("module-01");
  const m2 = document.getElementById("module-02");
  const kicker = document.getElementById("m2-kicker");
  if (kicker) {
    kicker.textContent = `Module 02 · Intake diagnostic · ${CHANNEL_LABEL[channel] || channel}`;
  }
  m2.hidden = false;
  const go = () => {
    flow.classList.add("is-m2");
    m1.setAttribute("aria-hidden", "true");
    m2.removeAttribute("aria-hidden");
  };
  if (animate) requestAnimationFrame(go);
  else go();
  if (channel === "welfare") {
    const benefit = document.getElementById("field-benefit");
    if (benefit && !readSession().intake) benefit.value = "yes";
  }
  renderEstimate();
}

function showModule1(animate) {
  const flow = document.getElementById("flow");
  const m1 = document.getElementById("module-01");
  const m2 = document.getElementById("module-02");
  flow.classList.remove("is-m2");
  m1.setAttribute("aria-hidden", "false");
  m2.setAttribute("aria-hidden", "true");
  const hide = () => {
    m2.hidden = true;
  };
  if (animate) setTimeout(hide, 450);
  else hide();
}

function restoreIntake(intake) {
  if (!intake) return;
  const assign = (id, value) => {
    const node = document.getElementById(id);
    if (node) node.value = value;
  };
  assign("field-partner", intake.partner ? "yes" : "no");
  assign("field-children", String(intake.children ?? 0));
  assign("field-area", String(intake.area ?? "1"));
  assign("field-benefit", intake.onBenefit ? "yes" : "no");
  assign("field-housing", intake.publicHousing ? "yes" : "no");
  assign("field-assets", String(intake.assets ?? 0));
  assign("field-rent", intake.rent ?? "");
  assign("field-income", intake.income ?? "");
  assign("field-disability", String(intake.disabilityCosts ?? 0));
  assign("field-other", String(intake.otherCosts ?? 0));
  assign("field-notice", intake.msdNotice || "");
  const meta = document.getElementById("file-meta");
  if (meta && intake.file) {
    meta.textContent = `In session: ${intake.file.name} (${intake.file.size} bytes).`;
  }
}

function boot() {
  let session = readSession();
  if (!session.id) {
    session = {
      id: newSessionId(),
      startedAt: new Date().toISOString(),
      channel: null,
      module: 1,
    };
    persistSession(session);
  }

  const idNode = document.getElementById("session-id");
  if (idNode) idNode.textContent = session.id;

  const form = document.getElementById("diagnostic-form");
  const status = document.getElementById("status-line");
  const intakeForm = document.getElementById("intake-form");

  if (session.channel) {
    const selected = form?.querySelector(`input[value="${session.channel}"]`);
    if (selected) selected.checked = true;
    if (status) status.textContent = `Channel locked: ${session.channel}.`;
  }

  if (session.module === 2 && session.channel) {
    restoreIntake(session.intake);
    showModule2(session.channel, false);
  }

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const channel = String(data.get("channel") || "");
    persistSession({
      channel,
      engagedAt: new Date().toISOString(),
      module: 2,
    });
    if (status) {
      status.textContent = `Diagnostic engaged · ${channel} · session ${readSession().id}`;
    }
    showModule2(channel, true);
  });

  intakeForm?.addEventListener("input", () => {
    const result = renderEstimate();
    persistSession({ intake: { ...readIntakeFields(), file: readSession().intake?.file || null }, estimate: result });
  });

  document.getElementById("lock-estimate")?.addEventListener("click", () => {
    const result = renderEstimate();
    persistSession({
      intake: { ...readIntakeFields(), file: readSession().intake?.file || null },
      estimate: result,
      estimateLockedAt: new Date().toISOString(),
    });
    alert(`Locked ${money(result.total)}/wk extra help into session ${readSession().id}.`);
  });

  document.getElementById("field-file")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    const meta = document.getElementById("file-meta");
    if (!file) {
      persistSession({ intake: { ...readIntakeFields(), file: null } });
      if (meta) meta.textContent = "No file in session. Binary is not stored; only name and text extracts persist until pagehide.";
      return;
    }
    const record = { name: file.name, size: file.size, type: file.type };
    persistSession({ intake: { ...readIntakeFields(), file: record } });
    if (meta) meta.textContent = `Captured ${file.name} (${file.size} bytes) — purged on pagehide.`;
    if (file.type.startsWith("text/") || file.name.endsWith(".txt") || file.name.endsWith(".html")) {
      const text = await file.text();
      const notice = document.getElementById("field-notice");
      if (notice && !notice.value.trim()) notice.value = text.slice(0, 8000);
      renderEstimate();
      persistSession({ intake: { ...readIntakeFields(), file: record } });
    }
  });

  document.getElementById("generate-pdf-btn")?.addEventListener("click", () => {
    const element = document.querySelector("main");
    const opt = {
      margin: 10,
      filename: "MSD_Review_Draft.pdf",
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
    };
    
    if (typeof html2pdf !== "undefined") {
      html2pdf().set(opt).from(element).save();
    } else {
      alert("PDF library loading... Please try again.");
    }
  });

  document.getElementById("back-m1")?.addEventListener("click", () => {
    persistSession({ module: 1 });
    showModule1(true);
  });

  tickClock();
  setInterval(tickClock, 1000);
}

window.addEventListener("pagehide", wipeSessionStore);
document.addEventListener("DOMContentLoaded", boot);
