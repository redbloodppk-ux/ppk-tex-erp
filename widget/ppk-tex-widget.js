// PPK TEX — iPhone home-screen widget
// =====================================================================
// Runs inside Scriptable (free, App Store). Shows looms running, the last
// logged day's metres, and reminders that are due.
//
// It shows NO money. No cash, no balances, no party names. That was a
// deliberate choice (16-Sep-2026): a key that lives on a phone can be lost
// with the phone, so the feed behind it was built to be worth stealing as
// little as possible.
//
// ---------------------------------------------------------------------
// SETTING IT UP — once, about five minutes
//
// 1. Install "Scriptable" from the App Store (free, by Simon B. Støvring).
//
// 2. Open Scriptable, tap + , and paste this whole file in.
//    Tap the settings icon at the bottom and name it "PPK TEX".
//
// 3. Put the key in the iPhone's Keychain instead of in this file.
//    Make a NEW script (+), paste just the two lines below, run it once,
//    then DELETE that script:
//
//        Keychain.set("ppktex_widget_token", "PASTE-THE-KEY-HERE");
//        console.log("saved");
//
//    Why the bother: scripts sync to iCloud Drive. Typed into this file,
//    the key would sync to Apple's servers with it. In the Keychain it
//    stays on the phone, and this file holds no secret at all.
//
// 4. Home screen → long-press → + → Scriptable → pick a size.
//    Long-press the new widget → Edit Widget → Script: PPK TEX.
//    Set "When Interacting" to "Run Script" so tapping opens the ERP.
//
// If the key is ever exposed: change WIDGET_API_TOKEN in Vercel and
// redeploy. Every phone holding the old key stops working at once.
// ---------------------------------------------------------------------

const BASE_URL = "https://ppk-tex-erp.vercel.app";
const FEED_PATH = "/app/api/widget/status";
const OPEN_PATH = "/app/dashboard";
const KEYCHAIN_KEY = "ppktex_widget_token";

const INDIGO = new Color("#534AB7");
const RED    = new Color("#A32D2D");
const AMBER  = new Color("#854F0B");
const GREEN  = new Color("#0F6E56");
const MUTED  = new Color("#6B6B66");

function token() {
  if (!Keychain.contains(KEYCHAIN_KEY)) return null;
  const t = Keychain.get(KEYCHAIN_KEY);
  return t && t.trim() ? t.trim() : null;
}

async function fetchStatus(key) {
  const req = new Request(BASE_URL + FEED_PATH);
  req.method = "GET";
  req.headers = { Authorization: "Bearer " + key };
  req.timeoutInterval = 15;
  const json = await req.loadJSON();
  // loadJSON does not throw on 401/503 — the body carries the complaint.
  if (json && json.error) throw new Error(json.error);
  return json;
}

/** "2026-09-12" -> "12 Sep". Kept short: widgets have no room. */
function shortDate(iso) {
  if (!iso) return "—";
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return String(d).padStart(2, "0") + " " + months[m - 1];
}

function headerRow(w, asOf) {
  const row = w.addStack();
  row.centerAlignContent();
  const dot = row.addText("●");
  dot.textColor = INDIGO;
  dot.font = Font.systemFont(9);
  row.addSpacer(4);
  const name = row.addText("PPK TEX");
  name.font = Font.mediumSystemFont(10);
  name.textColor = MUTED;
  row.addSpacer();
  if (asOf) {
    const t = row.addText(asOf.slice(11));
    t.font = Font.systemFont(9);
    t.textColor = MUTED;
  }
}

function bigStat(w, label, value, tint) {
  const l = w.addText(label);
  l.font = Font.systemFont(10);
  l.textColor = MUTED;
  const v = w.addText(value);
  v.font = Font.semiboldRoundedSystemFont(26);
  if (tint) v.textColor = tint;
}

function reminderLine(stack, item) {
  const row = stack.addStack();
  row.centerAlignContent();
  const badge = row.addText(item.overdue ? "!" : shortDate(item.due));
  badge.font = Font.boldSystemFont(9);
  badge.textColor = item.overdue ? RED : MUTED;
  row.addSpacer(5);
  const t = row.addText(item.title);
  t.font = Font.systemFont(11);
  t.textColor = item.overdue ? RED : MUTED;
  t.lineLimit = 1;
}

function errorWidget(message, hint) {
  const w = new ListWidget();
  w.backgroundColor = Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e"));
  headerRow(w, null);
  w.addSpacer(6);
  const t = w.addText(message);
  t.font = Font.mediumSystemFont(13);
  t.textColor = RED;
  if (hint) {
    w.addSpacer(3);
    const h = w.addText(hint);
    h.font = Font.systemFont(10);
    h.textColor = MUTED;
  }
  return w;
}

function buildWidget(data, family) {
  const w = new ListWidget();
  w.backgroundColor = Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e"));
  w.url = BASE_URL + OPEN_PATH;
  w.setPadding(14, 14, 14, 14);

  const looms = data.looms || {};
  const prod = data.production || {};
  const rem = data.reminders || {};
  const items = rem.items || [];
  const dueNow = Number(rem.due_now || 0);

  headerRow(w, data.as_of);
  w.addSpacer(8);

  // Small: the one number worth a glance, plus whether anything is waiting.
  if (family === "small") {
    bigStat(w, "Looms running", `${looms.running ?? "—"}/${looms.total ?? "—"}`);
    w.addSpacer(6);
    const p = w.addText(`${Number(prod.metres || 0).toLocaleString("en-IN")} m · ${shortDate(prod.date)}`);
    p.font = Font.systemFont(10);
    p.textColor = MUTED;
    w.addSpacer();
    const r = w.addText(dueNow > 0 ? `${dueNow} reminder${dueNow > 1 ? "s" : ""} due` : "Nothing due");
    r.font = Font.mediumSystemFont(11);
    r.textColor = dueNow > 0 ? AMBER : GREEN;
    return w;
  }

  // Medium and larger: two stats side by side, then the reminder list.
  const row = w.addStack();
  const left = row.addStack();
  left.layoutVertically();
  bigStat(left, "Looms running", `${looms.running ?? "—"}/${looms.total ?? "—"}`);
  row.addSpacer();
  const right = row.addStack();
  right.layoutVertically();
  bigStat(right, `Metres · ${shortDate(prod.date)}`, Number(prod.metres || 0).toLocaleString("en-IN"));

  w.addSpacer(10);

  const head = w.addText(dueNow > 0 ? `Reminders — ${dueNow} due` : "Reminders — none due");
  head.font = Font.mediumSystemFont(10);
  head.textColor = dueNow > 0 ? AMBER : GREEN;
  w.addSpacer(4);

  const list = w.addStack();
  list.layoutVertically();
  list.spacing = 3;
  const limit = family === "large" || family === "extraLarge" ? 4 : 2;
  if (items.length === 0) {
    const none = list.addText("No reminders set");
    none.font = Font.systemFont(11);
    none.textColor = MUTED;
  } else {
    items.slice(0, limit).forEach((it) => reminderLine(list, it));
  }

  w.addSpacer();
  return w;
}

// --- run ---------------------------------------------------------------
let widget;
const key = token();
if (!key) {
  widget = errorWidget(
    "Key not set",
    "Run the one-line Keychain script from the setup notes, then reload.",
  );
} else {
  try {
    const data = await fetchStatus(key);
    widget = buildWidget(data, config.widgetFamily || "medium");
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    widget = errorWidget(
      msg.indexOf("Unauthorized") >= 0 ? "Key rejected" : "Cannot reach ERP",
      msg.indexOf("Unauthorized") >= 0
        ? "The key was changed. Save the new one to the Keychain."
        : "Check the phone's connection and try again.",
    );
  }
}

// Ask iOS to come back in 15 minutes. It treats this as a hint, not an
// instruction — the system decides when a widget actually refreshes.
widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
}
Script.complete();
