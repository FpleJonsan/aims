const pptxgen = require("pptxgenjs");

// ---- Brand palette (from app/design-system/tokens.css — the real, live AIMS design system) ----
const C = {
  darkBg: "10231B",       // sidebar / title-slide dark
  primary: "173F2E",      // deep finance green
  primaryHover: "20543D",
  primaryActive: "2C6048",
  success: "24784C",
  successSurface: "E7F3EB",
  warning: "9A6415",
  warningSurface: "FFF3D8",
  danger: "AD4038",
  dangerSurface: "FAE9E7",
  info: "2F6F9F",
  infoSurface: "E8F1F8",
  ai: "6D51A8",            // AI advisory violet — never authority
  aiSurface: "F2EEF9",
  bg: "F5F6F3",
  white: "FFFFFF",
  ink: "16221D",
  muted: "5F6F67",
  line: "DDE3DE",
};

const FONT_HEAD = "Cambria";
const FONT_BODY = "Calibri";

const pres = new pptxgen();
pres.defineLayout({ name: "AIMS_WIDE", width: 13.333, height: 7.5 });
pres.layout = "AIMS_WIDE";
pres.author = "AIMS";
pres.company = "AIMS — AImazing Intelligent Management System";
pres.subject = "AIMS Competition Deck";
pres.title = "AIMS — AI-Powered Payment & Finance Control";

const PAGE_W = 13.333;
const MARGIN = 0.55;
const CONTENT_W = PAGE_W - MARGIN * 2;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bgSlide(slide, color) {
  slide.background = { color };
}

function kicker(slide, text, opts = {}) {
  slide.addText(text.toUpperCase(), {
    x: MARGIN, y: opts.y ?? 0.42, w: CONTENT_W, h: 0.3,
    fontFace: FONT_BODY, fontSize: 11, bold: true, color: opts.color ?? C.muted,
    charSpacing: 2, isTextBox: true, margin: 0,
  });
}

function title(slide, text, opts = {}) {
  slide.addText(text, {
    x: MARGIN, y: opts.y ?? 0.72, w: opts.w ?? CONTENT_W, h: opts.h ?? 0.9,
    fontFace: FONT_HEAD, fontSize: opts.size ?? 32, bold: true,
    color: opts.color ?? C.ink, isTextBox: true, margin: 0, align: "left",
    lineSpacingMultiple: 1.02,
  });
}

function subtitle(slide, text, opts = {}) {
  slide.addText(text, {
    x: MARGIN, y: opts.y ?? 1.5, w: opts.w ?? CONTENT_W, h: opts.h ?? 0.5,
    fontFace: FONT_BODY, fontSize: opts.size ?? 15, color: opts.color ?? C.muted,
    isTextBox: true, margin: 0,
  });
}

function pageFoot(slide, n) {
  slide.addText("AIMS · AI-Powered Payment & Finance Control", {
    x: MARGIN, y: 7.15, w: 8, h: 0.28, fontFace: FONT_BODY, fontSize: 9,
    color: C.muted, isTextBox: true, margin: 0,
  });
  slide.addText(String(n).padStart(2, "0"), {
    x: PAGE_W - MARGIN - 0.6, y: 7.15, w: 0.6, h: 0.28, fontFace: FONT_BODY,
    fontSize: 9, color: C.muted, align: "right", isTextBox: true, margin: 0,
  });
}

function card(slide, x, y, w, h, opts = {}) {
  slide.addShape("roundRect", {
    x, y, w, h, rectRadius: opts.radius ?? 0.09,
    fill: { color: opts.fill ?? C.white },
    line: opts.line === false ? { type: "none" } : { color: opts.lineColor ?? C.line, width: 0.75 },
    shadow: opts.shadow === false ? undefined : {
      type: "outer", color: "1B2B22", opacity: 0.12, blur: 10, offset: 3, angle: 90,
    },
  });
}

function pill(slide, x, y, w, h, text, opts = {}) {
  slide.addShape("roundRect", {
    x, y, w, h, rectRadius: h / 2,
    fill: { color: opts.fill ?? C.aiSurface },
    line: { type: "none" },
  });
  slide.addText(text, {
    x, y, w, h, align: "center", valign: "middle",
    fontFace: FONT_BODY, fontSize: opts.size ?? 10.5, bold: true,
    color: opts.color ?? C.ai, isTextBox: true, margin: 0, charSpacing: 0.5,
  });
}

function statCard(slide, x, y, w, h, label, value, note, opts = {}) {
  card(slide, x, y, w, h, { fill: opts.fill ?? C.white });
  slide.addText(label.toUpperCase(), {
    x: x + 0.22, y: y + 0.16, w: w - 0.44, h: 0.28,
    fontFace: FONT_BODY, fontSize: 10, bold: true, color: opts.labelColor ?? C.muted,
    isTextBox: true, margin: 0, charSpacing: 0.5,
  });
  slide.addText(value, {
    x: x + 0.22, y: y + 0.42, w: w - 0.44, h: 0.62,
    fontFace: FONT_HEAD, fontSize: opts.valueSize ?? 26, bold: true,
    color: opts.valueColor ?? C.ink, isTextBox: true, margin: 0,
  });
  if (note) {
    slide.addText(note, {
      x: x + 0.22, y: y + h - 0.42, w: w - 0.44, h: 0.34,
      fontFace: FONT_BODY, fontSize: 9.5, color: opts.noteColor ?? C.muted,
      isTextBox: true, margin: 0,
    });
  }
}

function iconDot(slide, x, y, d, fill) {
  slide.addShape("ellipse", { x, y, w: d, h: d, fill: { color: fill }, line: { type: "none" } });
}

function arrowRight(slide, x, y, w, color) {
  slide.addShape("rightArrow", {
    x, y: y - 0.045, w, h: 0.09,
    fill: { color }, line: { type: "none" },
  });
}

function flowStep(slide, x, y, w, h, label, opts = {}) {
  card(slide, x, y, w, h, { fill: opts.fill ?? C.white, shadow: false, lineColor: opts.lineColor ?? C.line });
  slide.addText(label, {
    x: x + 0.12, y, w: w - 0.24, h, align: "center", valign: "middle",
    fontFace: FONT_BODY, fontSize: opts.size ?? 11, bold: opts.bold ?? true,
    color: opts.color ?? C.ink, isTextBox: true, margin: 0,
  });
}

function newSlide(bg = C.bg) {
  const s = pres.addSlide();
  bgSlide(s, bg);
  return s;
}

// ===========================================================================
// SLIDE 1 — Title
// ===========================================================================
{
  const s = newSlide(C.darkBg);
  // wordmark mark
  slide_mark(s, MARGIN, 0.7, 0.62);
  s.addText("AIMS", {
    x: MARGIN + 0.85, y: 0.62, w: 6, h: 0.6,
    fontFace: FONT_HEAD, fontSize: 26, bold: true, color: C.white, isTextBox: true, margin: 0,
  });
  s.addText("FINANCE CONTROL", {
    x: MARGIN + 0.85, y: 1.08, w: 6, h: 0.3,
    fontFace: FONT_BODY, fontSize: 10.5, color: "9FB3A6", charSpacing: 2.5, isTextBox: true, margin: 0,
  });

  s.addText("AImazing Intelligent\nManagement System", {
    x: MARGIN, y: 2.55, w: 10.8, h: 1.7,
    fontFace: FONT_HEAD, fontSize: 46, bold: true, color: C.white,
    isTextBox: true, margin: 0, lineSpacingMultiple: 1.04,
  });
  s.addText("AI-Powered Payment & Finance Control", {
    x: MARGIN, y: 4.25, w: 10.8, h: 0.55,
    fontFace: FONT_BODY, fontSize: 20, color: "CFE0D5", isTextBox: true, margin: 0,
  });

  s.addText("From Request. To Control. To Financial Intelligence.", {
    x: MARGIN, y: 5.3, w: 10.8, h: 0.5,
    fontFace: FONT_HEAD, fontSize: 16, italic: true, color: "E7E9E4", isTextBox: true, margin: 0,
  });

  s.addText("Company AI Competition · Final Presentation", {
    x: MARGIN, y: 6.85, w: 8, h: 0.35,
    fontFace: FONT_BODY, fontSize: 11, color: "77897E", isTextBox: true, margin: 0,
  });
  s.addNotes("AIMS — AImazing Intelligent Management System. AI-powered payment and finance control. This is not a concept deck: AIMS is a working, end-to-end product that has gone through engineering acceptance and a real recorded workflow. Everything in this deck reflects the actual implemented system. Tagline: From Request, to Control, to Financial Intelligence.");
}

function slide_mark(s, x, y, d) {
  s.addShape("roundRect", { x, y, w: d, h: d, rectRadius: 0.14, fill: { color: C.ai }, line: { type: "none" } });
  s.addText("A", {
    x, y, w: d, h: d, align: "center", valign: "middle",
    fontFace: FONT_HEAD, fontSize: 24, bold: true, color: C.white, isTextBox: true, margin: 0,
  });
}

// ===========================================================================
// SLIDE 2 — The Problem
// ===========================================================================
{
  const s = newSlide();
  kicker(s, "01 · The Problem");
  title(s, "A payment request looks simple.\nThe financial reality isn’t.", { size: 30, h: 1.3 });

  // Hub and spoke: center "ONE REQUEST" node, 8 hidden-complexity chips around it
  const items = [
    ["Budget", C.primary], ["Actual spending", C.primary], ["Commitments", C.primary],
    ["Financial risk", C.danger], ["Compliance", C.warning], ["Approval authority", C.info],
    ["Payment readiness", C.success], ["Audit trail", C.muted],
  ];
  const cols = 4, cardW = 2.72, cardH = 0.95, gapX = 0.18, gapY = 0.22;
  const gridW = cols * cardW + (cols - 1) * gapX;
  const startX = MARGIN + (CONTENT_W - gridW) / 2;
  const startY = 2.55;
  items.forEach(([label, color], i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = startX + col * (cardW + gapX);
    const y = startY + row * (cardH + gapY);
    card(s, x, y, cardW, cardH, { fill: C.white, shadow: false });
    iconDot(s, x + 0.22, y + cardH / 2 - 0.07, 0.14, color);
    s.addText(label, {
      x: x + 0.48, y, w: cardW - 0.65, h: cardH, valign: "middle",
      fontFace: FONT_BODY, fontSize: 13, bold: true, color: C.ink, isTextBox: true, margin: 0,
    });
  });

  s.addText("Behind one request: budget pressure, historical spending, existing commitments, risk, compliance, approval authority, payment readiness, and the need for an audit trail.", {
    x: MARGIN, y: startY + 2 * (cardH + gapY) + 0.15, w: CONTENT_W, h: 0.55,
    fontFace: FONT_BODY, fontSize: 13, color: C.muted, isTextBox: true, margin: 0,
  });
  pageFoot(s, 2);
  s.addNotes("A payment request looks simple, but the financial reality behind it isn't. Every request carries budget pressure, historical spending, existing commitments, financial risk, compliance considerations, approval authority, payment readiness, and the need for an audit trail. Today most of that stays invisible until something goes wrong — a duplicate payment, an over-committed budget, an approval that skipped a step. AIMS exists to make that hidden complexity visible and controlled at every step.");
}

// ===========================================================================
// SLIDE 3 — The AIMS Idea
// ===========================================================================
{
  const s = newSlide();
  kicker(s, "02 · The AIMS Idea");
  title(s, "One controlled financial decision journey.", { size: 28 });

  const colW = (CONTENT_W - 0.5) / 2;
  const leftX = MARGIN, rightX = MARGIN + colW + 0.5;
  const topY = 2.05;
  const colH = 4.85;

  // Traditional column
  card(s, leftX, topY, colW, colH, { fill: C.white, shadow: false });
  s.addText("TRADITIONAL", {
    x: leftX + 0.3, y: topY + 0.26, w: colW - 0.6, h: 0.3,
    fontFace: FONT_BODY, fontSize: 12, bold: true, color: C.muted, charSpacing: 1.5, isTextBox: true, margin: 0,
  });
  const trad = ["Request", "Emails / chats / spreadsheets", "Manual checking", "Fragmented approval", "Limited visibility"];
  let ty = topY + 0.8;
  trad.forEach((t, i) => {
    flowStep(s, leftX + 0.3, ty, colW - 0.6, 0.55, t, { fill: "F1F1EF", color: C.muted, bold: false, lineColor: "E4E4E1" });
    ty += 0.55;
    if (i < trad.length - 1) {
      s.addShape("downArrow", { x: leftX + colW / 2 - 0.09, y: ty, w: 0.18, h: 0.18, fill: { color: "C7CAC5" }, line: { type: "none" } });
      ty += 0.22;
    }
  });

  // AIMS column
  card(s, rightX, topY, colW, colH, { fill: C.primary, shadow: false, lineColor: C.primary });
  s.addText("AIMS", {
    x: rightX + 0.3, y: topY + 0.26, w: colW - 0.6, h: 0.3,
    fontFace: FONT_BODY, fontSize: 12, bold: true, color: "BFE0CC", charSpacing: 1.5, isTextBox: true, margin: 0,
  });
  const aims = ["Request", "AI understanding", "Financial truth", "AI analysis", "Human decision", "Finance control", "Payment record", "Intelligence"];
  const stepH = 0.4, stepGap = 0.06;
  let ay = topY + 0.72;
  aims.forEach((t, i) => {
    const isAi = t.includes("AI") || t === "Intelligence";
    flowStep(s, rightX + 0.3, ay, colW - 0.6, stepH, t, {
      fill: isAi ? C.ai : C.white,
      color: isAi ? C.white : C.primary,
      lineColor: isAi ? C.ai : C.white,
    });
    ay += stepH + stepGap;
  });

  pageFoot(s, 3);
  s.addNotes("Traditionally, a payment request scatters across emails, chats, and spreadsheets, gets checked manually, approved in a fragmented way, and ends with limited visibility into what actually happened. AIMS turns this into one controlled journey: the same request flows through AI understanding, financial truth, AI analysis, a human decision, finance control, a payment record, and finally intelligence. Notice the pattern — AI steps and system/human steps alternate deliberately. AI never stands alone at a decision point.");
}

// ===========================================================================
// SLIDE 4 — How AIMS Works (12-stage lifecycle, grouped)
// ===========================================================================
{
  const s = newSlide();
  kicker(s, "03 · How AIMS Works");
  title(s, "The full payment lifecycle stays intact.", { size: 28 });
  subtitle(s, "12 governed stages, grouped into 5 phases — nothing skipped, nothing shortcut.", { y: 1.5 });

  const groups = [
    { name: "REQUEST", range: "Stages 1–3", stages: "Request Initiation · Request Capture · Validation", color: C.info, surface: C.infoSurface },
    { name: "UNDERSTAND & ANALYZE", range: "Stages 4–5", stages: "Finance Context · Financial Risk Analysis", color: C.ai, surface: C.aiSurface },
    { name: "DECIDE", range: "Stages 6–7", stages: "Policy & Decision · Approval", color: C.warning, surface: C.warningSurface },
    { name: "CONTROL & RECORD", range: "Stages 8–10", stages: "Final Finance Control · Payment Processing · Payment Record", color: C.primary, surface: C.successSurface },
    { name: "VISIBILITY & INTELLIGENCE", range: "Stages 11–12", stages: "Finance Dashboard · AI Finance Intelligence", color: C.success, surface: C.successSurface },
  ];

  const n = groups.length;
  const gap = 0.22;
  const w = (CONTENT_W - gap * (n - 1)) / n;
  const y = 2.35, h = 3.55;
  groups.forEach((g, i) => {
    const x = MARGIN + i * (w + gap);
    card(s, x, y, w, h, { fill: C.white, shadow: false });
    s.addShape("roundRect", { x: x + 0.18, y: y + 0.2, w: 0.42, h: 0.42, rectRadius: 0.08, fill: { color: g.surface }, line: { type: "none" } });
    s.addText(String(i + 1), {
      x: x + 0.18, y: y + 0.2, w: 0.42, h: 0.42, align: "center", valign: "middle",
      fontFace: FONT_HEAD, fontSize: 16, bold: true, color: g.color, isTextBox: true, margin: 0,
    });
    s.addText(g.name, {
      x: x + 0.18, y: y + 0.78, w: w - 0.36, h: 0.75,
      fontFace: FONT_BODY, fontSize: 13, bold: true, color: C.ink, isTextBox: true, margin: 0, lineSpacingMultiple: 1.05,
    });
    s.addText(g.range, {
      x: x + 0.18, y: y + 1.5, w: w - 0.36, h: 0.28,
      fontFace: FONT_BODY, fontSize: 10, bold: true, color: g.color, isTextBox: true, margin: 0,
    });
    s.addShape("line", { x: x + 0.18, y: y + 1.86, w: w - 0.36, h: 0, line: { color: "E7E9E4", width: 1 } });
    s.addText(g.stages, {
      x: x + 0.18, y: y + 1.98, w: w - 0.36, h: h - 2.15,
      fontFace: FONT_BODY, fontSize: 10.5, color: C.muted, isTextBox: true, margin: 0, lineSpacingMultiple: 1.25,
    });
    if (i < n - 1) arrowRight(s, x + w + 0.02, y + h / 2, gap - 0.04, "C7CAC5");
  });

  pageFoot(s, 4);
  s.addNotes("AIMS keeps the full 12-stage payment request lifecycle intact — nothing skipped, nothing shortcut. We group it into five phases for clarity: Request (stages 1–3) captures and validates the ask. Understand & Analyze (4–5) builds financial context and runs risk analysis. Decide (6–7) applies policy and gets human approval. Control & Record (8–10) is where Final Finance Control, payment processing, and the payment record happen. Visibility & Intelligence (11–12) is the Finance Dashboard and AI Finance Intelligence. Authentication and user administration are platform capabilities — deliberately outside this lifecycle.");
}

// ===========================================================================
// SLIDE 5 — AI + Financial Truth
// ===========================================================================
{
  const s = newSlide();
  kicker(s, "04 · AI + Financial Truth");
  title(s, "AI interprets. The system calculates.", { size: 30 });

  const colW = (CONTENT_W - 0.4) / 2;
  const leftX = MARGIN, rightX = MARGIN + colW + 0.4;
  const topY = 2.05, colH = 2.9;

  card(s, leftX, topY, colW, colH, { fill: C.aiSurface, shadow: false, lineColor: C.aiSurface });
  pill(s, leftX + 0.3, topY + 0.28, 2.5, 0.4, "AI INTERPRETATION", { fill: C.ai, color: C.white });
  const aiItems = ["Document understanding", "Financial risk signals", "Spending patterns", "Compliance indicators", "Plain-language explanation"];
  s.addText(aiItems.map((t) => ({ text: t, options: { bullet: { code: "2013" }, breakLine: true, color: C.ink, fontSize: 13 } })), {
    x: leftX + 0.3, y: topY + 0.9, w: colW - 0.6, h: colH - 1.1,
    fontFace: FONT_BODY, isTextBox: true, margin: 0, paraSpaceAfter: 10,
  });

  card(s, rightX, topY, colW, colH, { fill: C.successSurface, shadow: false, lineColor: C.successSurface });
  pill(s, rightX + 0.3, topY + 0.28, 2.6, 0.4, "SYSTEM CALCULATED", { fill: C.primary, color: C.white });
  const sysItems = ["Active budget", "Actual ledger", "Active commitments", "Available position", "Ledger impact on payment"];
  s.addText(sysItems.map((t) => ({ text: t, options: { bullet: { code: "2013" }, breakLine: true, color: C.ink, fontSize: 13 } })), {
    x: rightX + 0.3, y: topY + 0.9, w: colW - 0.6, h: colH - 1.1,
    fontFace: FONT_BODY, isTextBox: true, margin: 0, paraSpaceAfter: 10,
  });

  // Equation band
  const eqY = topY + colH + 0.35, eqH = 1.05;
  card(s, MARGIN, eqY, CONTENT_W, eqH, { fill: C.darkBg, shadow: false, lineColor: C.darkBg });
  s.addText([
    { text: "Available", options: { color: C.white, bold: true } },
    { text: "  =  Active Budget  −  Actual Ledger  −  Active Commitments", options: { color: "CFE0D5" } },
  ], {
    x: MARGIN, y: eqY, w: CONTENT_W, h: eqH, align: "center", valign: "middle",
    fontFace: FONT_HEAD, fontSize: 22, isTextBox: true, margin: 0,
  });

  pageFoot(s, 5);
  s.addNotes("This is the core idea of AIMS. AI interprets — it reads documents, flags financial risk signals, spots spending patterns, checks compliance indicators, and explains its reasoning in plain language. But AI never calculates the authoritative financial position. That's the system's job, deterministically: active budget, actual ledger, active commitments, available position, and the ledger impact of a payment. The equation is fixed and code-level, verified directly in AIMS's finance-context calculation: Available equals Active Budget minus Actual Ledger minus Active Commitments. AI is never the source of truth for a balance.");
}

// ===========================================================================
// SLIDE 6 — Multi-Agent Financial Analysis
// ===========================================================================
{
  const s = newSlide();
  kicker(s, "05 · Multi-Agent Financial Analysis");
  title(s, "Multiple perspectives. One evidence-backed assessment.", { size: 26 });
  subtitle(s, "Human authority remains final.", { y: 1.45, size: 15 });

  const agents = [
    ["Financial Risk", "Flags exposure signals"],
    ["Spending Pattern", "Surfaces anomalies vs. history"],
    ["Compliance", "Checks policy indicators"],
  ];
  const cardW = 3.5, cardH = 1.5, gap = 0.35;
  const totalW = agents.length * cardW + (agents.length - 1) * gap;
  const startX = MARGIN + (CONTENT_W - totalW) / 2;
  const y1 = 2.15;
  agents.forEach(([t, d], i) => {
    const x = startX + i * (cardW + gap);
    card(s, x, y1, cardW, cardH, { fill: C.aiSurface, shadow: false, lineColor: C.aiSurface });
    s.addText(t, {
      x: x + 0.25, y: y1 + 0.2, w: cardW - 0.5, h: 0.4,
      fontFace: FONT_BODY, fontSize: 15, bold: true, color: C.ai, isTextBox: true, margin: 0,
    });
    s.addText(d, {
      x: x + 0.25, y: y1 + 0.66, w: cardW - 0.5, h: 0.7,
      fontFace: FONT_BODY, fontSize: 11.5, color: C.ink, isTextBox: true, margin: 0,
    });
  });

  // convergence arrows down to aggregator
  const midX = MARGIN + CONTENT_W / 2;
  s.addShape("downArrow", { x: midX - 0.14, y: y1 + cardH + 0.08, w: 0.28, h: 0.32, fill: { color: C.ai }, line: { type: "none" } });

  const aggY = y1 + cardH + 0.55;
  card(s, midX - 2.1, aggY, 4.2, 0.85, { fill: C.ai, shadow: false, lineColor: C.ai });
  s.addText("AGGREGATOR — evidence-backed assessment", {
    x: midX - 2.1, y: aggY, w: 4.2, h: 0.85, align: "center", valign: "middle",
    fontFace: FONT_BODY, fontSize: 13, bold: true, color: C.white, isTextBox: true, margin: 0,
  });

  s.addShape("downArrow", { x: midX - 0.14, y: aggY + 0.85 + 0.08, w: 0.28, h: 0.32, fill: { color: C.primary }, line: { type: "none" } });

  const hfY = aggY + 0.85 + 0.55;
  card(s, midX - 2.6, hfY, 5.2, 0.85, { fill: C.primary, shadow: false, lineColor: C.primary });
  s.addText("HUMAN FINAL ASSESSMENT — decision authority", {
    x: midX - 2.6, y: hfY, w: 5.2, h: 0.85, align: "center", valign: "middle",
    fontFace: FONT_BODY, fontSize: 14, bold: true, color: C.white, isTextBox: true, margin: 0,
  });

  pageFoot(s, 6);
  s.addNotes("Financial Risk Analysis runs as multiple focused AI agents — Financial Risk, Spending Pattern, and Compliance — each looking at the request from a different angle. Their outputs are combined by an Aggregator into one evidence-backed assessment. Critically, that assessment is not the decision. It feeds a Human Final Assessment, where a person makes the actual call. Multiple perspectives, one evidence-backed summary, and human authority stays final. Worth noting honestly: in our own rehearsal environment, some of these AI sub-agents hit provider timeouts under a smaller reasoning model — the design point is that the human review step never depended on them succeeding.");
}

// ===========================================================================
// SLIDE 7 — Human Governance
// ===========================================================================
{
  const s = newSlide();
  kicker(s, "06 · Human Governance");
  title(s, "AI assists decisions. Humans retain authority.", { size: 27 });

  const chain = ["Requester", "Policy", "Approver", "Final Finance\nControl", "External\nPayment", "AIMS\nRecord"];
  const n = chain.length;
  const gap = 0.22;
  const w = (CONTENT_W - gap * (n - 1)) / n;
  const y = 2.15, h = 1.05;
  chain.forEach((t, i) => {
    const x = MARGIN + i * (w + gap);
    const isFFC = i === 3;
    card(s, x, y, w, h, { fill: isFFC ? C.primary : C.white, shadow: false, lineColor: isFFC ? C.primary : C.line });
    s.addText(t, {
      x: x + 0.08, y, w: w - 0.16, h, align: "center", valign: "middle",
      fontFace: FONT_BODY, fontSize: 12, bold: true, color: isFFC ? C.white : C.ink, isTextBox: true, margin: 0,
    });
    if (i < n - 1) arrowRight(s, x + w + 0.02, y + h / 2, gap - 0.04, "C7CAC5");
  });

  // Two bold statements
  const bandY = 3.55, bandH = 0.95, bandGap = 0.3;
  const bandW = (CONTENT_W - bandGap) / 2;
  card(s, MARGIN, bandY, bandW, bandH, { fill: C.dangerSurface, shadow: false, lineColor: C.dangerSurface });
  s.addText("APPROVED ≠ READY FOR PAYMENT", {
    x: MARGIN, y: bandY, w: bandW, h: bandH, align: "center", valign: "middle",
    fontFace: FONT_HEAD, fontSize: 18, bold: true, color: C.danger, isTextBox: true, margin: 0,
  });
  card(s, MARGIN + bandW + bandGap, bandY, bandW, bandH, { fill: C.aiSurface, shadow: false, lineColor: C.aiSurface });
  s.addText("AI NEVER APPROVES PAYMENTS", {
    x: MARGIN + bandW + bandGap, y: bandY, w: bandW, h: bandH, align: "center", valign: "middle",
    fontFace: FONT_HEAD, fontSize: 18, bold: true, color: C.ai, isTextBox: true, margin: 0,
  });

  // Segregation of duties
  s.addText("SEGREGATION OF DUTIES", {
    x: MARGIN, y: 4.9, w: CONTENT_W, h: 0.3,
    fontFace: FONT_BODY, fontSize: 11, bold: true, color: C.muted, charSpacing: 1.5, isTextBox: true, margin: 0,
  });
  const roles = ["Requester", "Approver", "Finance", "Finance Master", "Technical Admin"];
  const rw = (CONTENT_W - 0.2 * (roles.length - 1)) / roles.length;
  roles.forEach((r, i) => {
    const x = MARGIN + i * (rw + 0.2);
    pill(s, x, 5.3, rw, 0.55, r, { fill: C.white, color: C.primary, size: 11.5 });
    s.addShape("roundRect", { x, y: 5.3, w: rw, h: 0.55, rectRadius: 0.275, fill: { type: "none" }, line: { color: C.line, width: 1 } });
  });
  s.addText("Technical Admin does not equal Finance authority — access is not approval.", {
    x: MARGIN, y: 6.05, w: CONTENT_W, h: 0.4,
    fontFace: FONT_BODY, fontSize: 12, italic: true, color: C.muted, isTextBox: true, margin: 0,
  });

  pageFoot(s, 7);
  s.addNotes("This is the governance backbone. A request moves from Requester through Policy to an Approver — but approval is not the end. Final Finance Control is a separate, deterministic gate performed by Finance after approval, checking approval completeness, evidence, amount and payee integrity, budget reservation, and duplicate-payment protection. Only after that does an external payment happen, which AIMS then records. Two statements we want judges to remember: Approved does not equal Ready for Payment, and AI never approves payments — full stop. Segregation of duties is enforced by role: Requester, Approver, Finance, Finance Master, and Technical Admin are distinct, and a Technical Admin's system access is explicitly not financial authority.");
}

// ===========================================================================
// SLIDE 8 — Real End-to-End Case
// ===========================================================================
{
  const s = newSlide();
  kicker(s, "07 · Real End-to-End Case");
  title(s, "PAY-2026-000041 — a real request, start to finish.", { size: 25 });

  // Case card
  const caseY = 1.85, caseH = 1.5;
  card(s, MARGIN, caseY, CONTENT_W, caseH, { fill: C.white, shadow: false });
  const fields = [
    ["Payee", "BrightWave Media Sdn. Bhd."],
    ["Department", "Operations"],
    ["Purpose", "Digital Marketing Campaign"],
    ["Total", "MYR 18,500.00"],
  ];
  const fw = CONTENT_W / fields.length;
  fields.forEach(([l, v], i) => {
    const x = MARGIN + i * fw;
    s.addText(l.toUpperCase(), {
      x: x + 0.3, y: caseY + 0.24, w: fw - 0.4, h: 0.28,
      fontFace: FONT_BODY, fontSize: 10, bold: true, color: C.muted, charSpacing: 1, isTextBox: true, margin: 0,
    });
    s.addText(v, {
      x: x + 0.3, y: caseY + 0.55, w: fw - 0.4, h: 0.75,
      fontFace: FONT_HEAD, fontSize: i === 3 ? 20 : 14, bold: true, color: i === 3 ? C.primary : C.ink,
      isTextBox: true, margin: 0, lineSpacingMultiple: 1.05,
    });
    if (i > 0) s.addShape("line", { x, y: caseY + 0.25, w: 0, h: caseH - 0.5, line: { color: C.line, width: 1 } });
  });

  // 3 claims
  const claimY = 3.6;
  s.addText("THREE CLAIM ITEMS", {
    x: MARGIN, y: claimY, w: CONTENT_W, h: 0.3,
    fontFace: FONT_BODY, fontSize: 11, bold: true, color: C.muted, charSpacing: 1.5, isTextBox: true, margin: 0,
  });
  const claims = [["Campaign Media Placement", "MYR 8,000.00"], ["Creative Production", "MYR 6,500.00"], ["Campaign Analytics Service", "MYR 4,000.00"]];
  const ccW = (CONTENT_W - 0.3 * 2) / 3;
  claims.forEach(([l, v], i) => {
    const x = MARGIN + i * (ccW + 0.3);
    card(s, x, claimY + 0.35, ccW, 0.85, { fill: C.bg, shadow: false, lineColor: C.line });
    s.addText(l, { x: x + 0.2, y: claimY + 0.45, w: ccW - 0.4, h: 0.35, fontFace: FONT_BODY, fontSize: 11.5, color: C.ink, isTextBox: true, margin: 0 });
    s.addText(v, { x: x + 0.2, y: claimY + 0.78, w: ccW - 0.4, h: 0.35, fontFace: FONT_BODY, fontSize: 13, bold: true, color: C.primary, isTextBox: true, margin: 0 });
  });

  // Progression stepper
  const stepY = 5.1;
  s.addText("WORKFLOW PROGRESSION", {
    x: MARGIN, y: stepY, w: CONTENT_W, h: 0.3,
    fontFace: FONT_BODY, fontSize: 11, bold: true, color: C.muted, charSpacing: 1.5, isTextBox: true, margin: 0,
  });
  const steps = ["Submitted", "AI Validated", "Financially\nAnalyzed", "Human\nApproved", "Finance\nControlled", "Payment\nRecorded", "PAID"];
  const n = steps.length;
  const gap = 0.16;
  const w = (CONTENT_W - gap * (n - 1)) / n;
  const y = stepY + 0.4, h = 0.95;
  steps.forEach((t, i) => {
    const x = MARGIN + i * (w + gap);
    const isFinal = i === n - 1;
    card(s, x, y, w, h, { fill: isFinal ? C.success : C.white, shadow: false, lineColor: isFinal ? C.success : C.line });
    s.addText(t, {
      x: x + 0.05, y, w: w - 0.1, h, align: "center", valign: "middle",
      fontFace: FONT_BODY, fontSize: isFinal ? 14 : 10.5, bold: true, color: isFinal ? C.white : C.ink, isTextBox: true, margin: 0,
    });
    if (i < n - 1) arrowRight(s, x + w + 0.01, y + h / 2, gap - 0.02, "C7CAC5");
  });

  pageFoot(s, 8);
  s.addNotes("This is a genuine request from our own environment, not a mockup: PAY-2026-000041, BrightWave Media Sdn. Bhd., Operations department, Digital Marketing Campaign, MYR 18,500 total across three claims — Campaign Media Placement, Creative Production, and Campaign Analytics Service. We pulled this directly from the live system: it was submitted, AI-validated, financially analyzed, approved by a human, controlled by Finance, had its payment recorded, and shows PAID today. This is the same lifecycle from slide 4, walked end to end on a real case.");
}

// ===========================================================================
// SLIDE 9 — Financial Visibility
// ===========================================================================
{
  const s = newSlide();
  kicker(s, "08 · Financial Visibility");
  title(s, "From payment workflow to real financial visibility.", { size: 26 });
  subtitle(s, "Live snapshot after PAY-2026-000041 · all figures system-calculated", { y: 1.42, size: 13 });

  const stats = [
    ["Active Budget", "MYR 121,000", "Live approved budget", C.ink, C.white],
    ["Actual Spending", "MYR 76,000", "Authoritative ledger", C.ink, C.white],
    ["Active Commitments", "MYR 109,000", "Active reservations", C.ink, C.white],
    ["Available", "-MYR 64,000", "Over committed — surfaced, not hidden", C.white, C.danger],
    ["Paid This Period", "MYR 56,000", "Immutable payment records", C.ink, C.white],
    ["Requests Processed", "4", "Completed operational workload", C.ink, C.white],
  ];
  const cols = 3, cw = (CONTENT_W - 0.3 * (cols - 1)) / cols, ch = 1.55;
  const startY = 2.05;
  stats.forEach(([label, value, note, textColor, fill], i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = MARGIN + col * (cw + 0.3);
    const y = startY + row * (ch + 0.25);
    statCard(s, x, y, cw, ch, label, value, note, {
      fill, valueColor: textColor, labelColor: fill === C.danger ? "F6DEDB" : C.muted,
      noteColor: fill === C.danger ? "F6DEDB" : C.muted, valueSize: 24,
    });
  });

  s.addText("Negative Available is displayed on the live dashboard — AIMS surfaces budget pressure instead of concealing it.", {
    x: MARGIN, y: startY + 2 * (ch + 0.25) + 0.08, w: CONTENT_W, h: 0.4,
    fontFace: FONT_BODY, fontSize: 11.5, italic: true, color: C.muted, isTextBox: true, margin: 0,
  });

  pageFoot(s, 9);
  s.addNotes("These are the real, live figures on our Finance Dashboard immediately after PAY-2026-000041 was paid — not illustrative numbers. Active Budget MYR 121,000, Actual Spending MYR 76,000, Active Commitments MYR 109,000, which nets to an Available position of negative MYR 64,000. Paid This Period is MYR 56,000 across 4 processed requests. Every one of these is system-calculated, not AI-generated. The point of this slide is the negative Available figure: AIMS shows it in red, on the live dashboard, rather than hiding budget pressure. That is what real financial visibility looks like.");
}

// ===========================================================================
// SLIDE 10 — Ask AIMS
// ===========================================================================
{
  const s = newSlide();
  kicker(s, "09 · Ask AIMS");
  title(s, "Financial truth first. AI explanation second.", { size: 27 });

  const colW = (CONTENT_W - 0.4) / 2;
  const leftX = MARGIN, rightX = MARGIN + colW + 0.4;
  const topY = 2.05, colH = 3.5;

  // Left: deterministic dashboard fact
  card(s, leftX, topY, colW, colH, { fill: C.white, shadow: false });
  pill(s, leftX + 0.3, topY + 0.3, 2.9, 0.4, "SYSTEM CALCULATED", { fill: C.primary, color: C.white });
  s.addText("Finance Dashboard", {
    x: leftX + 0.3, y: topY + 0.95, w: colW - 0.6, h: 0.35,
    fontFace: FONT_BODY, fontSize: 13, bold: true, color: C.muted, isTextBox: true, margin: 0,
  });
  s.addText("Paid This Period", {
    x: leftX + 0.3, y: topY + 1.35, w: colW - 0.6, h: 0.35,
    fontFace: FONT_BODY, fontSize: 14, color: C.ink, isTextBox: true, margin: 0,
  });
  s.addText("MYR 56,000.00", {
    x: leftX + 0.3, y: topY + 1.7, w: colW - 0.6, h: 0.85,
    fontFace: FONT_HEAD, fontSize: 34, bold: true, color: C.primary, isTextBox: true, margin: 0,
  });
  s.addText("4 requests processed · immutable payment records", {
    x: leftX + 0.3, y: topY + 2.65, w: colW - 0.6, h: 0.5,
    fontFace: FONT_BODY, fontSize: 11, color: C.muted, isTextBox: true, margin: 0,
  });

  // Right: Ask AIMS
  card(s, rightX, topY, colW, colH, { fill: C.aiSurface, shadow: false, lineColor: C.aiSurface });
  pill(s, rightX + 0.3, topY + 0.3, 2.9, 0.4, "EVIDENCE-BOUNDED AI", { fill: C.ai, color: C.white });
  s.addText("“What is the total financial impact of\npayments made this period?”", {
    x: rightX + 0.3, y: topY + 0.95, w: colW - 0.6, h: 0.75,
    fontFace: FONT_BODY, fontSize: 13, italic: true, color: C.ink, isTextBox: true, margin: 0, lineSpacingMultiple: 1.15,
  });
  card(s, rightX + 0.3, topY + 1.8, colW - 0.6, 1.5, { fill: C.white, shadow: false, lineColor: "E3DAF0" });
  s.addText("“Total financial impact (sum of provided paid amounts) for the selected period is MYR 56000.00.”", {
    x: rightX + 0.5, y: topY + 1.95, w: colW - 1.0, h: 1.2,
    fontFace: FONT_BODY, fontSize: 13, color: C.ink, isTextBox: true, margin: 0, lineSpacingMultiple: 1.2,
  });

  s.addText("Ask AIMS answered from bounded, authorized evidence — the same figure the deterministic dashboard already showed. It is not a general chatbot and cannot run arbitrary queries.", {
    x: MARGIN, y: topY + colH + 0.25, w: CONTENT_W, h: 0.55,
    fontFace: FONT_BODY, fontSize: 12, color: C.muted, isTextBox: true, margin: 0,
  });

  pageFoot(s, 10);
  s.addNotes("We asked Ask AIMS, in our live environment, 'What is the total financial impact of payments made this period?' It answered: 'Total financial impact (sum of provided paid amounts) for the selected period is MYR 56000.00.' That is the exact figure the deterministic Finance Dashboard already showed as Paid This Period. This is the point of evidence-bounded AI: Ask AIMS only reasons over authorized evidence it's given — it doesn't run arbitrary queries, and in other real runs in our environment it has explicitly refused to answer when the evidence didn't support a claim, rather than guessing. Financial truth first, AI explanation second.");
}

// ===========================================================================
// SLIDE 11 — Why AIMS Matters (closing)
// ===========================================================================
{
  const s = newSlide(C.darkBg);
  kicker(s, "10 · Why AIMS Matters", { color: "9FB3A6" });
  s.addText("Intelligent control, not maximum automation.", {
    x: MARGIN, y: 0.75, w: CONTENT_W, h: 0.7,
    fontFace: FONT_HEAD, fontSize: 28, bold: true, color: C.white, isTextBox: true, margin: 0,
  });

  const pillars = [
    ["CONTROL", "Financial truth before payment", "诚信 Integrity"],
    ["EFFICIENCY", "One workflow, not fragmented checking", "效率 Efficiency"],
    ["INTELLIGENCE", "AI turns evidence into decision support", "学无止境 Continuous Learning"],
    ["GOVERNANCE", "Humans and Finance retain authority", "团队精神 Teamwork"],
    ["VISIBILITY", "Every payment updates the financial picture", "用户第一 Customer First"],
  ];
  const n = pillars.length, gap = 0.2;
  const w = (CONTENT_W - gap * (n - 1)) / n, y = 1.75, h = 2.55;
  pillars.forEach(([t, d, principle], i) => {
    const x = MARGIN + i * (w + gap);
    s.addShape("roundRect", { x, y, w, h, rectRadius: 0.09, fill: { color: "17301F" }, line: { color: "26402C", width: 1 } });
    iconDot(s, x + 0.25, y + 0.28, 0.16, C.ai);
    s.addText(t, {
      x: x + 0.2, y: y + 0.55, w: w - 0.4, h: 0.5,
      fontFace: FONT_BODY, fontSize: 13, bold: true, color: C.white, charSpacing: 0.5, isTextBox: true, margin: 0,
    });
    s.addText(d, {
      x: x + 0.2, y: y + 1.05, w: w - 0.4, h: 1.05,
      fontFace: FONT_BODY, fontSize: 11, color: "CFE0D5", isTextBox: true, margin: 0, lineSpacingMultiple: 1.2,
    });
    s.addShape("line", { x: x + 0.2, y: y + h - 0.55, w: w - 0.4, h: 0, line: { color: "2E4A36", width: 1 } });
    s.addText(principle, {
      x: x + 0.2, y: y + h - 0.45, w: w - 0.4, h: 0.35,
      fontFace: FONT_BODY, fontSize: 9, italic: true, color: "8FA898", isTextBox: true, margin: 0,
    });
  });

  s.addText("From Request. To Control. To Financial Intelligence.", {
    x: MARGIN, y: 4.75, w: CONTENT_W, h: 0.55,
    fontFace: FONT_HEAD, fontSize: 20, italic: true, color: C.white, isTextBox: true, margin: 0, align: "center",
  });
  slide_mark(s, PAGE_W / 2 - 0.35, 5.5, 0.7);
  s.addText("AIMS", {
    x: MARGIN, y: 6.35, w: CONTENT_W, h: 0.55,
    fontFace: FONT_HEAD, fontSize: 22, bold: true, color: C.white, isTextBox: true, margin: 0, align: "center", charSpacing: 3,
  });
  pageFoot(s, 11);
  s.addNotes("AIMS's strength isn't maximum automation — it's intelligent control. Five things it delivers: Control, financial truth established before any payment; Efficiency, one workflow instead of fragmented manual checking; Intelligence, AI turning evidence into decision support rather than decisions themselves; Governance, humans and Finance keeping authority end to end; and Visibility, every payment updating the real financial picture. These map naturally to our company principles — Integrity in financial truth and governance, Efficiency in one unified workflow, Continuous Learning in AI-driven financial intelligence, Teamwork across Requester, Approver, and Finance, and Customer First in faster, clearer payment handling. From Request, to Control, to Financial Intelligence. That's AIMS.");
}

// ===========================================================================
// APPENDIX A1 — Architecture
// ===========================================================================
{
  const s = newSlide();
  kicker(s, "Appendix A1 · Architecture");
  title(s, "What AIMS is actually built on.", { size: 27 });

  const items = [
    ["Frontend", "Next.js / React"],
    ["API", "NestJS · REST · strict DTO validation"],
    ["Database", "PostgreSQL · append-only history · lifecycle triggers"],
    ["Worker", "PostgreSQL-backed outbox worker (no Redis/BullMQ runtime dependency)"],
    ["AI Provider", "OpenAI-compatible · schema-validated structured outputs (Zod)"],
    ["Document Storage", "Local adapter for development/demo — production S3-class storage is a stated prerequisite"],
    ["Notifications", "Web domain commands + optional Telegram adapter — Telegram never owns approval logic"],
  ];
  const rowH = 0.62, startY = 2.05;
  items.forEach(([l, v], i) => {
    const y = startY + i * rowH;
    s.addText(l, {
      x: MARGIN, y, w: 2.6, h: rowH, valign: "middle",
      fontFace: FONT_BODY, fontSize: 13, bold: true, color: C.primary, isTextBox: true, margin: 0,
    });
    s.addText(v, {
      x: MARGIN + 2.75, y, w: CONTENT_W - 2.75, h: rowH, valign: "middle",
      fontFace: FONT_BODY, fontSize: 12.5, color: C.ink, isTextBox: true, margin: 0,
    });
    if (i < items.length - 1) s.addShape("line", { x: MARGIN, y: y + rowH, w: CONTENT_W, h: 0, line: { color: C.line, width: 0.75 } });
  });
  s.addText("Note: an early architecture plan specified Nuxt/Vue and Redis+BullMQ. The team deliberately revised this during implementation — a documented trade-off, not an inconsistency.", {
    x: MARGIN, y: startY + items.length * rowH + 0.2, w: CONTENT_W, h: 0.6,
    fontFace: FONT_BODY, fontSize: 10.5, italic: true, color: C.muted, isTextBox: true, margin: 0,
  });
  pageFoot(s, "A1");
  s.addNotes("For technical judges: the frontend is Next.js/React, the API is NestJS with strict DTO validation, and the database is PostgreSQL with append-only history and lifecycle triggers. The background worker is PostgreSQL-backed, not Redis/BullMQ — that was an early plan the team deliberately revised during implementation, a documented and reasoned trade-off. AI runs through an OpenAI-compatible provider with Zod-schema-validated structured outputs. Document storage today is a local adapter for development and demo; production-grade object storage is a stated prerequisite, not simulated. Notifications flow through web domain commands with an optional Telegram adapter that never owns approval logic.");
}

// ===========================================================================
// APPENDIX A2 — AI Governance
// ===========================================================================
{
  const s = newSlide();
  kicker(s, "Appendix A2 · AI Governance");
  title(s, "AI is optional. The workflow never depends on it.", { size: 25 });

  const cols = [
    { h: "AI ON / OFF", items: ["Master switch + per-capability flags", "Document Validation, Financial Risk,", "Spending Pattern, Compliance,", "Finance Watch, Ask AIMS — each toggled independently"] },
    { h: "Manual Fallback", items: ["Three modes: AI-Assisted, Manual,", "AI-Unavailable Fallback", "Deterministic Finance Dashboard", "always remains available"] },
    { h: "Evidence & Authority", items: ["Every AI result is schema-validated", "Human assessment always preserved", "Source tagged AI / MANUAL / RULE_BASED", "AI never gains autonomous authority"] },
  ];
  const cw = (CONTENT_W - 0.3 * 2) / 3;
  cols.forEach((c, i) => {
    const x = MARGIN + i * (cw + 0.3);
    card(s, x, 2.05, cw, 3.6, { fill: C.white, shadow: false });
    s.addText(c.h, {
      x: x + 0.25, y: 2.3, w: cw - 0.5, h: 0.5,
      fontFace: FONT_BODY, fontSize: 14, bold: true, color: C.ai, isTextBox: true, margin: 0,
    });
    s.addText(c.items.join("\n"), {
      x: x + 0.25, y: 2.9, w: cw - 0.5, h: 2.6,
      fontFace: FONT_BODY, fontSize: 11.5, color: C.ink, isTextBox: true, margin: 0, lineSpacingMultiple: 1.35,
    });
  });
  s.addText("Observed in this environment: several AI sub-agents experienced provider timeouts during rehearsal. The product is designed to fail safely — deterministic paths and human review remain available when AI does not respond.", {
    x: MARGIN, y: 5.85, w: CONTENT_W, h: 0.7,
    fontFace: FONT_BODY, fontSize: 11, italic: true, color: C.muted, isTextBox: true, margin: 0,
  });
  pageFoot(s, "A2");
  s.addNotes("AI in AIMS is fully optional. There's a master switch plus independent per-capability flags for Document Validation, Financial Risk, Spending Pattern, Compliance, Finance Watch, and Ask AIMS. Three operating modes exist: AI-Assisted, Manual, and AI-Unavailable Fallback — the deterministic Finance Dashboard always remains available regardless of AI state. Every AI result is schema-validated, human assessment is always preserved alongside it, and each result is source-tagged AI, MANUAL, or RULE_BASED. We're transparent that in our own rehearsal environment, several AI sub-agents hit provider-side timeouts — the product is built to fail safely, not to hide that.");
}

// ===========================================================================
// APPENDIX A3 — Enterprise Controls
// ===========================================================================
{
  const s = newSlide();
  kicker(s, "Appendix A3 · Enterprise Controls");
  title(s, "Controls that make AIMS auditable.", { size: 27 });

  const items = [
    ["Role / Permission Matrix", "Database-backed RBAC across Dashboard, Request, Validation, Finance, Approval, Payment, Reporting"],
    ["Approval Matrix & Delegation", "Configurable approval routing with delegation support"],
    ["Final Finance Control", "A separate deterministic gate after Approval — checks authority, evidence, amount, duplicates"],
    ["Immutable Audit Trail", "Append-only history with lifecycle triggers"],
    ["Payment Idempotency", "Duplicate-payment detection blocks silent re-execution"],
    ["Database Trust Boundaries", "Authorization is never trusted from the frontend alone"],
  ];
  const cols = 2, cw = (CONTENT_W - 0.4) / 2, ch = 1.55;
  items.forEach(([t, d], i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = MARGIN + col * (cw + 0.4);
    const y = 2.05 + row * (ch + 0.22);
    card(s, x, y, cw, ch, { fill: C.white, shadow: false });
    s.addText(t, {
      x: x + 0.25, y: y + 0.2, w: cw - 0.5, h: 0.4,
      fontFace: FONT_BODY, fontSize: 13.5, bold: true, color: C.primary, isTextBox: true, margin: 0,
    });
    s.addText(d, {
      x: x + 0.25, y: y + 0.62, w: cw - 0.5, h: ch - 0.8,
      fontFace: FONT_BODY, fontSize: 11.5, color: C.ink, isTextBox: true, margin: 0, lineSpacingMultiple: 1.2,
    });
  });
  pageFoot(s, "A3");
  s.addNotes("A quick rundown of the enterprise controls that make AIMS auditable: a database-backed Role/Permission Matrix across every major module; a configurable Approval Matrix with delegation support; Final Finance Control as a separate deterministic gate after Approval; an append-only, immutable audit trail with lifecycle triggers; payment idempotency that blocks silent duplicate execution; and database-enforced trust boundaries, meaning authorization is never taken on faith from the frontend alone.");
}

pres.writeFile({ fileName: "AIMS-Competition-Deck-v1.pptx" }).then(() => {
  console.log("DONE");
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
