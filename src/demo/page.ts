/** Recorded Northglass Plumbing playground. No lead data is fetched at runtime. */
export const PLAYGROUND_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LeadFlow — the front desk for a one-shop business</title>
<meta name="description" content="An MCP server that lets an AI assistant capture a lead, score it with a published rubric, and tell you who to call first. No paid APIs.">
<meta property="og:title" content="LeadFlow — the front desk for a one-shop business">
<meta property="og:description" content="Capture a lead, score it with a published rubric, chase the follow-up, and read the pipeline. This page replays a recorded fictional demo.">
<meta property="og:url" content="https://leadflow-mcp.kfairley9999.workers.dev">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">
<link rel="canonical" href="https://leadflow-mcp.kfairley9999.workers.dev">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
  :root {
    --paper: #f3efe4;
    --ink: #1d1a16;
    --muted: #5e574c;
    --rule: #d9d0c0;
    --add: #e5f2e6;
    --add-ink: #1d5c32;
    --del: #f8e4dc;
    --del-ink: #8d2d16;
    --stamp: #9d2c14;
    --pass: #1d5c32;
    --panel: #fffdf8;
    --hot: #9d2c14;
    --cool: #5e574c;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: var(--paper);
    color: var(--ink);
    font-family: Palatino, "Iowan Old Style", "Palatino Linotype", Georgia, serif;
    min-height: 100vh;
  }
  header, .layout, footer {
    max-width: 1100px;
    margin: 0 auto;
  }
  header { padding: 28px 32px 8px; }
  .mark {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    font-size: 12px;
    margin: 0 0 8px;
  }
  h1 {
    font-weight: 500;
    font-size: 28px;
    line-height: 1.25;
    margin: 0;
    max-width: 18em;
  }
  .lede {
    color: var(--muted);
    font-size: 16px;
    line-height: 1.45;
    max-width: 36em;
    margin: 10px 0 0;
  }
  .cta {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    margin: 14px 0 0;
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 12px;
  }
  .cta a {
    color: var(--ink);
    text-decoration: none;
    border-bottom: 1px solid var(--rule);
    padding-bottom: 1px;
  }
  .cta a:hover { border-bottom-color: var(--ink); }
  button:focus-visible, a:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  .layout {
    display: grid;
    grid-template-columns: 240px 1fr;
    gap: 24px;
    padding: 20px 32px 48px;
  }
  nav { display: flex; flex-direction: column; gap: 6px; }
  nav button {
    text-align: left;
    background: transparent;
    border: 0;
    border-left: 3px solid transparent;
    padding: 8px 10px;
    font: inherit;
    color: var(--ink);
    cursor: pointer;
  }
  nav button small {
    display: block;
    color: var(--muted);
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 11px;
    margin-top: 2px;
  }
  nav button[aria-current="true"] { border-left-color: var(--stamp); background: #fffaf3; }
  main { min-width: 0; }
  #stage {
    background: var(--panel);
    border: 1px solid var(--rule);
    min-height: 360px;
    padding: 20px 22px 24px;
  }
  .kicker {
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
    margin: 0 0 10px;
  }
  .metrics {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin: 0 0 18px;
  }
  .metric {
    border: 1px solid var(--rule);
    padding: 10px 12px;
  }
  .metric b {
    display: block;
    font-size: 22px;
    font-weight: 500;
    margin-top: 4px;
  }
  .metric span {
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 11px;
    color: var(--muted);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .stages, .list, .factors { margin: 0; padding: 0; list-style: none; }
  .stages {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0 0 16px;
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 12px;
    color: var(--muted);
  }
  .stages li { border: 1px solid var(--rule); padding: 4px 8px; }
  .list li, .due, .factors li {
    padding: 10px 0;
    border-top: 1px solid var(--rule);
  }
  .list li:first-child, .due:first-child, .factors li:first-child { border-top: 0; }
  .name { display: block; }
  .meta {
    color: var(--muted);
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 12px;
    margin-top: 2px;
  }
  .score-head { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; }
  .score-head h2 { font-size: 22px; font-weight: 500; margin: 0; }
  .badge {
    font-family: ui-monospace, Menlo, Consolas, monospace;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    border: 2px solid var(--stamp);
    color: var(--stamp);
    padding: 6px 10px;
    transform: rotate(-2deg);
  }
  .badge.cool { border-color: var(--muted); color: var(--muted); }
  .factors li { display: grid; grid-template-columns: 4.5em 1fr; gap: 12px; }
  .factors .pts {
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 13px;
  }
  .prose { margin: 8px 0 16px; color: var(--ink); }
  footer {
    padding: 0 32px 32px;
    color: var(--muted);
    font-size: 14px;
  }
  @media (max-width: 800px) {
    header { padding: 20px 16px 0; }
    h1 { font-size: 22px; }
    .layout { grid-template-columns: 1fr; padding: 12px 16px 32px; }
    nav { flex-direction: row; overflow-x: auto; }
    nav button { min-width: 160px; border-left: 0; border-bottom: 3px solid transparent; }
    nav button[aria-current="true"] { border-bottom-color: var(--stamp); }
    .metrics { grid-template-columns: 1fr 1fr; }
    footer { padding: 0 16px 24px; }
    .score-head { flex-direction: column; align-items: flex-start; }
  }
</style>
</head>
<body>
<header>
  <p class="mark">LeadFlow</p>
  <h1>The front desk for a one-shop business.</h1>
  <p class="lede">An AI assistant captures a lead, scores it with a published rubric, and tells you who to call first. No paid APIs. This page replays a recorded demo. It does not talk to a live book of business.</p>
  <p class="cta">
    <a href="https://github.com/kfairy9999/leadflow-mcp">Source on GitHub</a>
    <a href="https://github.com/kfairy9999/leadflow-mcp#quickstart">Install locally</a>
    <a href="https://www.agensi.io/skills/leadflow-mcp-small-business-lead-pipeline">Agensi listing</a>
  </p>
</header>
<div class="layout">
  <nav id="views" aria-label="Recorded views"></nav>
  <main>
    <section id="stage" aria-live="polite"></section>
  </main>
</div>
<footer>
  Recorded demo of the fictional Northglass Plumbing seed in Harborton.
  Clock pinned to 2026-11-18T15:00:00.000Z, the same session as <code>npm run demo</code>.
  The MCP endpoint at <code>/mcp</code> requires a bearer token and is not this page.
</footer>
<script>
const VIEWS = [
  {
    id: "pipeline",
    title: "Morning brief",
    hint: "pipeline_summary",
    render: pipeline
  },
  {
    id: "due",
    title: "Due today",
    hint: "3 follow-ups",
    render: due
  },
  {
    id: "marina",
    title: "Score Marina Cho",
    hint: "100/100 hot",
    render: () => score({
      name: "Marina Cho",
      stage: "proposal",
      value: "$4,800.00",
      service: "Tankless water heater install",
      band: "hot",
      total: 100,
      blurb: "Hot follow-up priority, 100/100. Strongest signal: Referral is the strongest source in this rubric.",
      factors: [
        ["+22", "source — Referral is the strongest source in this rubric."],
        ["+10", "phone — A phone number is on file."],
        ["+8", "email — An email address is on file."],
        ["+20", "urgency — Urgency is high."],
        ["+12", "value — Estimated value is $1,500 to $4,999.99."],
        ["+16", "stage — Stage is proposal. Closest open stage to a decision."],
        ["+16", "recency — Last activity was under 2 days ago."],
        ["-4", "cap — The raw total exceeded 100, so the published ceiling was applied."],
        ["= 100", "Published score."]
      ]
    })
  },
  {
    id: "samira",
    title: "Score Samira Adeyemi",
    hint: "27/100 cool",
    render: () => score({
      name: "Samira Adeyemi",
      stage: "contacted",
      value: "$220.00",
      service: "Water heater flush",
      band: "cool",
      total: 27,
      blurb: "Cool follow-up priority, 27/100. Strongest signal: Website lead. Ahead of a cold inquiry, behind a referral.",
      factors: [
        ["+14", "source — Website lead. Ahead of a cold inquiry, behind a referral."],
        ["+8", "email — An email address is on file."],
        ["+6", "urgency — Urgency is normal."],
        ["+4", "value — Estimated value is under $400."],
        ["+7", "stage — Stage is contacted. A conversation has started."],
        ["-12", "recency — No activity for 18 days. Open leads go quiet after 14 days."],
        ["= 27", "Published score."]
      ]
    })
  }
];

const params = new URLSearchParams(location.search);
let viewId = params.get("view") || VIEWS[0].id;
if (!VIEWS.some((item) => item.id === viewId)) viewId = VIEWS[0].id;

const nav = document.getElementById("views");
const stage = document.getElementById("stage");

function pipeline() {
  const root = document.createElement("div");
  root.innerHTML = '<p class="kicker">Pipeline as of 2026-11-18T15:00:00.000Z</p>';
  const metrics = document.createElement("div");
  metrics.className = "metrics";
  for (const [label, value] of [
    ["Open", "8"],
    ["Open value", "$21,050.00"],
    ["Win rate", "1/2 (50.0%)"],
    ["Stale (>7d)", "2"]
  ]) {
    const card = document.createElement("div");
    card.className = "metric";
    card.innerHTML = "<span></span><b></b>";
    card.querySelector("span").textContent = label;
    card.querySelector("b").textContent = value;
    metrics.appendChild(card);
  }
  root.appendChild(metrics);
  const stages = document.createElement("ul");
  stages.className = "stages";
  for (const label of ["new 2", "contacted 2", "qualified 1", "proposal 3", "won 1", "lost 1"]) {
    const item = document.createElement("li");
    item.textContent = label;
    stages.appendChild(item);
  }
  root.appendChild(stages);
  const list = document.createElement("ul");
  list.className = "list";
  for (const [name, meta] of [
    ["Samira Adeyemi", "contacted · Water heater flush · 18d quiet"],
    ["Rowan Blake", "qualified · Outdoor faucet winterize · 8d quiet"]
  ]) {
    const item = document.createElement("li");
    item.innerHTML = '<span class="name"></span><div class="meta"></div>';
    item.querySelector(".name").textContent = name;
    item.querySelector(".meta").textContent = meta;
    list.appendChild(item);
  }
  root.appendChild(list);
  return root;
}

function due() {
  const root = document.createElement("div");
  root.innerHTML = '<p class="kicker">3 follow-ups due as of 2026-11-18T15:00:00.000Z</p>';
  const list = document.createElement("div");
  for (const [name, meta, reason] of [
    ["Priya Nandakumar", "due 2026-11-17T13:00:00.000Z", "Main line is still unanswered."],
    ["Marina Cho", "due 2026-11-18T13:00:00.000Z", "Confirm the tankless install window."],
    ["Luis Ortega", "due 2026-11-18T14:30:00.000Z", "Call back about the no-hot-water emergency."]
  ]) {
    const item = document.createElement("div");
    item.className = "due";
    item.innerHTML = '<span class="name"></span><div class="meta"></div><p class="prose"></p>';
    item.querySelector(".name").textContent = name;
    item.querySelector(".meta").textContent = meta;
    item.querySelector(".prose").textContent = reason;
    list.appendChild(item);
  }
  root.appendChild(list);
  return root;
}

function score(data) {
  const root = document.createElement("div");
  const kicker = document.createElement("p");
  kicker.className = "kicker";
  kicker.textContent = data.stage + " · " + data.value + " · " + data.service;
  root.appendChild(kicker);
  const head = document.createElement("div");
  head.className = "score-head";
  const title = document.createElement("h2");
  title.textContent = data.name;
  const badge = document.createElement("div");
  badge.className = "badge" + (data.band === "hot" ? "" : " cool");
  badge.textContent = data.total + "/100 " + data.band;
  head.appendChild(title);
  head.appendChild(badge);
  root.appendChild(head);
  const blurb = document.createElement("p");
  blurb.className = "prose";
  blurb.textContent = data.blurb;
  root.appendChild(blurb);
  const factors = document.createElement("ul");
  factors.className = "factors";
  for (const [pts, text] of data.factors) {
    const item = document.createElement("li");
    item.innerHTML = '<span class="pts"></span><span></span>';
    item.children[0].textContent = pts;
    item.children[1].textContent = text;
    factors.appendChild(item);
  }
  root.appendChild(factors);
  return root;
}

function draw() {
  nav.replaceChildren();
  for (const item of VIEWS) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.title;
    const small = document.createElement("small");
    small.textContent = item.hint;
    button.appendChild(small);
    if (item.id === viewId) button.setAttribute("aria-current", "true");
    button.addEventListener("click", () => {
      viewId = item.id;
      draw();
    });
    nav.appendChild(button);
  }
  const current = VIEWS.find((item) => item.id === viewId);
  stage.replaceChildren(current.render());
  const url = new URL(location.href);
  url.searchParams.set("view", viewId);
  history.replaceState(null, "", url);
}

draw();
</script>
</body>
</html>
`;

export const ROBOTS_TXT = `User-agent: *
Allow: /

# MCP at /mcp requires a bearer token and is not for crawlers.
`;

export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#f3efe4"/><rect x="1.5" y="1.5" width="29" height="29" fill="none" stroke="#9d2c14" stroke-width="1.5"/><text x="16" y="23" text-anchor="middle" font-family="Georgia, Palatino, serif" font-size="18" fill="#1d1a16">L</text></svg>`;
