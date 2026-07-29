# THE———BOARD — Product Roadmap & Checklist

Written from a **business / customer** lens, not an engineering one. The question throughout is
"will someone use this, and would they pay?" — not "is this technically interesting?"

---

## 1. Who is this for?

Three candidate segments. **Pick one to win first.** Products that target "teams" in general
lose to Miro; products that own a niche get bought by that niche and expand later.

### Segment A — Educators & tutors ⭐ recommended
Teachers, coaching centres, online tutors, university TAs.

| | |
|---|---|
| **Job to be done** | "Explain something visually to 30 students, let them mark it up, and give them the marked-up sheet afterwards." |
| **Today they use** | Zoom + a PDF + maybe a physical whiteboard on camera. Three tools, nothing saved. |
| **Why we win** | Annotate the actual worksheet live; every student leaves with their own copy. |
| **Willingness to pay** | Moderate individually, high at institution level. |
| **Reachable?** | Yes — teacher communities, coaching centres, edu Twitter/LinkedIn. |

### Segment B — Design & product review
Design crits, architecture review, UX walkthroughs.

| | |
|---|---|
| **Job to be done** | "Get 6 people to mark up the same screen/diagram and leave with decisions recorded." |
| **Today** | Figma comments + Zoom. Figma is very strong here. |
| **Why we win** | Weakly. Figma owns this. **Hard segment — do not start here.** |

### Segment C — Document review (legal, finance, consulting)
Contract markup, proposal review, audit walkthroughs.

| | |
|---|---|
| **Job to be done** | "Three people read the same contract on a call and mark it up together." |
| **Today** | Screenshare + "page 4, paragraph 2, no the other one." Genuinely painful. |
| **Why we win** | Live shared PDF annotation + per-person export + audit trail. |
| **Willingness to pay** | **Highest of the three.** Billable hours make tools cheap. |
| **Risk** | Long sales cycles, compliance demands, security review. |

**Recommendation: start with A (education), design so C (document review) is reachable later.**
Education gives fast feedback and forgiving users; document review gives revenue.

---

## 2. The honest competitive picture

| Competitor | Strong at | Weak at | Our angle |
|---|---|---|---|
| **Miro** | Canvas, templates, ecosystem | Calls are bolted on; heavy; pricey | Lighter; call is native |
| **FigJam** | Beautiful, fast, design-native | No real calls; weak documents | Documents + calls |
| **Zoom** | Calls at scale | Whiteboard is an afterthought; annotations vanish | The artifact survives |
| **MS Whiteboard** | Free with Teams | Clunky; Teams-locked | Works anywhere, no install |
| **Excalidraw** | Fast, free, lovely feel | No calls, no accounts, no docs | Everything it lacks |

**The one-sentence wedge:**
> Everyone marks up the same document together, live — and each person leaves with their own
> annotated copy.

Zoom genuinely cannot do the second half. That is the thing to sell.

**What is NOT a differentiator** (say this out loud so we stop over-valuing it):
canvas drawing, sticky notes, templates, basic AI. All table stakes. All already exist elsewhere.

---

## 3. Feature checklist

Scored **Value** (customer pull) × **Effort**. Order is by value-per-hour, not by interest.

### 🔴 P0 — Blocks real usage

- [ ] **Durable database (Postgres)** — *V: critical · E: 1h*
      Every redeploy currently deletes all accounts and boards. Nothing else matters until fixed.
- [ ] **Set `JWT_SECRET` + `CLIENT_ORIGIN` in production** — *V: critical · E: 5m*
- [ ] **Decide the access model: code-grants-access vs invite-only** — *V: critical · E: decision*
      Joining is confusing until this is settled.
- [ ] **Roles: owner / admin / editor / commenter / viewer** — *V: high · E: 6h*
      The answer to "students would delete things."
- [ ] **Soft delete + restore (30-day trash)** — *V: high · E: 3h*
      Removes the fear of letting people in. Big trust unlock.
- [ ] **Remove or properly implement the 15-min session timer** — *V: high · E: 30m*
      Currently client-side only; F5 bypasses it. Pure downside as-is.

### 🟠 P1 — The differentiators

- [ ] **PDF import → annotate → export** — *V: very high · E: 6h* ⭐ **the wedge**
- [ ] **Per-attendee annotated copy** — *V: very high · E: 2h*
      This is the part Zoom cannot do. Market it explicitly.
- [ ] **Sticky notes v2** — *V: high · E: 5h*
      Shapes, rich text, links, link previews, attachments, expand-to-edit, author + timestamp.
- [ ] **Sticky note side panel** — *V: high · E: 2h*
      List every note, filter by author/tag, click to fly to it. Becomes search later.
- [ ] **Multiple sheets per board (Excel-style tabs)** — *V: high · E: 3h*
      Turns a one-off board into a workspace.
- [ ] **Google sign-in** — *V: high · E: 2h*
      Removes signup friction and password-reset support burden entirely.
- [ ] **Export whole board as PDF** — *V: medium · E: 1h*
- [ ] **Activity log — who joined, who changed what, when** — *V: high for orgs · E: 3h*
      Often the feature that makes a school or firm say yes.

### 🟡 P2 — Retention and growth

- [ ] **Version history + restore** (`board_versions` table already exists, unused) — *E: 3h*
- [ ] **Templates by segment** — lesson plan, contract review, retro, sprint board — *E: 2h*
- [ ] **Search across notes, text, chat** — *E: 3h*
- [ ] **Comments with @mentions + resolve** — *E: 4h*
- [ ] **Duplicate a board** — *E: 1h*
- [ ] **Board folders / workspaces** — *E: 4h*
- [ ] **Presence: "3 people viewing"** — *E: 1h*
- [ ] **Follow-the-presenter mode** — *E: 2h*
- [ ] **Meeting summary from chat + board activity** (AI already wired) — *E: 3h*
- [ ] **Email digest: "here's what changed in your board"** — *E: 3h*

### 🔵 P3 — Scale (only when demand proves it)

- [ ] **SFU for calls >6 people** (LiveKit) — *E: 1 day · costs money*
- [ ] **Redis pub/sub between server instances** — *E: 1 day*
- [ ] **Recording + transcript** — *E: 2 days*
- [ ] **Mobile / tablet editing** — *E: 1 week*
- [ ] **SSO / SAML** — only when an enterprise asks — *E: 3 days*

---

## 4. Features a customer analyst would add that engineers forget

These are cheap and disproportionately affect whether people stay.

- [ ] **Empty-state onboarding** — a 30-second guided first board, not a blank canvas
- [ ] **Demo board on the landing page** — let people try it with no signup at all
- [ ] **Shareable read-only snapshot link** — for people who will never make an account
- [ ] **"Copy board as image to clipboard"** — the most-used export in practice
- [ ] **Keyboard shortcut cheatsheet on first visit** (exists behind `?`, nobody finds it)
- [ ] **Undo toast** — "Deleted 4 shapes · Undo" — removes fear
- [ ] **Autosave indicator** — people don't trust what they can't see saving
- [ ] **"Someone is editing" indicator on the board list**
- [ ] **Offline banner** — already built; make sure it's visible
- [ ] **Slow-connection mode** — degrade to audio-only automatically
- [ ] **Session recap email after a call ends**
- [ ] **Guest access with a name prompt** — no account, still identifiable

---

## 5. Metrics to instrument (before optimising anything)

Currently we measure **nothing**. Without this, feature decisions are guesses.

- [ ] Signup → first board created (activation)
- [ ] First board → second board (does it stick?)
- [ ] Boards with ≥2 participants (is it actually collaborative?)
- [ ] Calls started / average duration
- [ ] AI commands used per board — **which of the four earns its keep?**
- [ ] PDFs imported / exported (proves or kills the wedge)
- [ ] Day-7 and day-30 retention
- [ ] Time-to-first-shape (should be < 30s)

**Cheapest useful version:** log events to a Postgres table. No analytics vendor needed.

---

## 6. Pricing hypothesis (validate, don't assume)

| Tier | Price | Limits |
|---|---|---|
| **Free** | ₹0 | 3 boards, 3 collaborators, 40-min calls, 5 AI/day |
| **Pro** | ~₹400/mo | Unlimited boards, 10 collaborators, unlimited calls, PDF export |
| **Team** | ~₹300/user/mo | Roles, audit log, SSO later, admin controls |
| **Edu** | Discounted / free | Classroom mode — the growth channel |

The 40-minute free call limit is Zoom's proven wedge. Do the same. Note the *current* 15-minute
timer is not this — it is client-side, bypassable, and applies to boards rather than calls.

---

## 7. Biggest risks

1. **Doing everything, owning nothing.** Miro wins the general case. Pick a niche.
2. **Calls at scale are expensive.** 60–70 video participants needs an SFU and real money.
   Audio-first with a few video tiles is the affordable, honest design.
3. **PDF annotation is the whole bet** — if it isn't excellent, there is no reason to switch.
4. **Trust.** Schools and firms ask about data handling early. Roles + audit log + soft delete
   are the minimum credible answer.
5. **No feedback loop.** Nothing is measured yet, so every roadmap call is an opinion.

---

## 8. Suggested order

**Now (this week)**
1. Postgres · 2. Prod env vars · 3. Access-model decision · 4. Kill/fix the timer

**Next (the wedge)**
5. PDF import → annotate → export · 6. Per-attendee copy · 7. Sticky notes v2 + panel

**Then (make it a product)**
8. Google sign-in · 9. Roles + soft delete · 10. Sheets · 11. Activity log

**Then (learn)**
12. Metrics · 13. Onboarding · 14. Demo board · 15. Pricing test

**Only if demand proves it**
16. SFU · 17. Multi-instance · 18. Recording · 19. Mobile
