# Resubmit gap list — Submission 8d30c74b (rejected 2026-07-10)

Status of each rejection item, and what is still open. Verified against the tree
on 2026-08-05.

---

## 1. Guideline 2.1 — demo video  ❌ BLOCKING, nothing produced

Shot list exists (`demo-video-shotlist.md`); no video, no URL.

Apple asked for **one specific video**: current build on a **physical iPhone**
(not simulator), the **initial pairing**, and the **entire workflow** — iPhone
and hardware **both in frame**, ideally one take.

⚠️ The "how the electronics work" explainer you're planning is **not** this
video. Keep them separate:
- ASC → App Review Information → **Demo Video URL** = the iPhone+locker walkthrough.
- Electronics explainer + DIY handbook = **5.2.1 attachments** (see §2).

Sending only the explainer re-triggers 2.1.

### Review of `~/Desktop/IMG_0668.MOV` (42s, 1080×1920) — reviewed frame by frame

It is better than I assumed: iPhone and solenoids are in the **same frame**
throughout, and it does cover the cycle —
station screen (sport select · 30 min · OYNA) → **"kapı açılıyor…"** →
session timer **29:57** → **"seans tamamlandı · teşekkürler"** back on the map.
That satisfies "entire app workflow with the designated hardware."

Four things to fix before sending it:

1. 🔴 **No initial pairing.** Apple named this explicitly and it's the most
   likely repeat-rejection. The clip opens already on the station screen. Add
   the front half: app launch → map → the station appearing as nearby/in-range →
   tap → connect. Playbox has no iOS pairing dialog (advert-only presence,
   GATT link on tap), so **label it on screen** — e.g. "app discovers the
   station over Bluetooth" / "connecting". Show the equivalent, don't skip it.
2. 🟠 **The station is named "PLAYBOX DEV WORKSHOP" / `DEV-001`.** A reviewer
   reads "DEV" as a test rig, not the shipping product. Rename it for the film.
3. 🟠 **The latches lie loose on a table** — the open/close motion isn't
   unmistakable on camera. Mount them on a board or cardboard "door" as
   `demo-video-shotlist.md` already recommends. The reviewer must *see* the
   hardware respond to the tap.
4. 🟡 **42s with no labels or narration** reads as a highlight reel. Add an
   on-screen caption per step and let each breathe — 2–4 min, one take.

Re-shoot against the **new build** (the one with `supportsTablet: false` +
`cfaeddc`), since Apple requires "the current version of the app".

---

## 2. Guideline 5.2.1 — authorization  ⚠️ reply written, evidence to assemble

**No company and no trademark is required to clear this.** Apple is not asking
for TÜRKPATENT registration. 5.2.1 asks one question: *is Playbox someone else's
product that you're controlling without permission?* The answer is no — you are
an individual developer who designed, built and operates the hardware yourself.
An individual developer account is a perfectly normal answer here.

Reply text is written in `apple-review-reply.md` (§5.2.1) — declaration of sole
authorship, no company claimed.

Evidence to attach (you already have most of it):
- [x] Assembly manual — `~/Downloads/PlayBox_Montaj_Kilavuzu.pdf` (5 pages,
      authored by you). Strong: nobody writes the build manual for hardware they
      don't own.
- [x] Enclosure parts photo — `~/Desktop/parts.webp`
- [x] Build/operation video — `~/Desktop/IMG_0668.MOV` (42s)
- [x] Electronics photos in repo root (`electronics.png`, `case.png`, `case2.png`)
- [ ] Domain ownership for **playboxsport.com** (registrar receipt / WHOIS
      screenshot). `lib/legal.ts` already points there — easiest strong item.
- [ ] Signed declaration of sole authorship (adapt `authorization-letter.md`;
      sign as an individual, not on behalf of an entity)
- [ ] Optional but persuasive: parts purchase receipts, and a screenshot of the
      firmware git history showing dated first-party development.

Combine into one PDF and attach in App Review Information.

🟡 **The name is the real risk, not the paperwork.** "PlayBox" is a name other
products have used (a broadcast-systems vendor, and a well-known piracy
streaming app). That is a plausible reason Apple assumed a third party, and no
amount of authorship evidence changes a name collision. Your brand plan already
moves off "PlayBox" — if the rename is close, doing it *before* resubmitting is
cheaper than clearing 5.2.1 twice. If you want to ship now, submit the evidence
package as-is; it's a reasonable shot.

---

## 3. Guideline 2.1(a) — demo access  ⚠️ code fixed, ASC side open

Fixed in the tree (`cfaeddc`, 2026-07-10 — after build 37 was reviewed):
`REQUIRED` is all-`false`, `ctaEnabled = true`, chips now render "opsiyonel".
The reviewer's screenshot showing **bluetooth · ZORUNLU · "izin verilmedi, devam
etmek için gerekli"** came from build 37 and is what convinced them they were
blocked.

Review notes are written and pasted into ASC. ✅ Demo Login only, no phone path
mentioned — correct, since `REVIEW_PHONE` is an unset placeholder with no
Supabase Test OTP behind it.

Still open:
- [ ] **Submit a build that contains `cfaeddc` or later.** Verify build 38's
      commit — do NOT rely on OTA; Apple may test before it applies.
- [x] **iPad dropped.** `app.json` → `supportsTablet: false` (set 2026-08-05).
      The reviewer's iPad Air screenshot showed the phone-entry screen stretched
      with ~70% dead space; iPhone-only removes that surface from review.
      → Needs a **new native build** (app.json change, not OTA-able).
      → In ASC you can now **delete the iPad screenshot set** — no longer required.

---

## 4. Guideline 2.3.7 — pricing in screenshots  ❌ open in ASC

The live screenshot reads **"ANINDA. ÜCRETSİZ. CEBİNDE."** — "ÜCRETSİZ" (free)
is a price reference. Screenshot sources aren't in this repo.

- [x] "ÜCRETSİZ" removed from the screenshot (2026-08-05).
- [ ] Sweep the rest for "bedava", "ilk seans ücretsiz", "₺", "TL", "indirim" —
      2.3.7 covers app name, subtitle and promo text too, not just screenshots.
      (A "first session free" claim is fine in the **description**.)
- [ ] Delete the iPad screenshot set (no longer required — §3).

⚠️ **Theme mismatch to check.** The reviewer's screenshots and the demo video
both show the app in the **light coral** theme, but the store screenshot is
**dark + volt lime** (Asphalt Volt). Guideline 2.3.3 requires screenshots to
show the app as it actually appears. If the submitted build is still light
coral, either ship the dark theme in that build or reshoot the screenshots from
the build you're submitting.

---

## 5. Guideline 2.1 / 1.3 — data practices  ✅ drafted, one thing to verify

The reply in `apple-review-reply.md` is accurate — confirmed no analytics/ads
SDKs in `package.json`.

- [x] **Age rating: 4+, category "Not Applicable"** — correct. NOT "Made for
      Kids". Leave it exactly as is. Guideline 1.3 is the Kids Category, so this
      is not a kids app and the reply says so explicitly.
      *(Brazil "General Audiences", Korea "All", Vietnam "00+ All Ages" are just
      Apple auto-mapping 4+ onto those countries' national rating boards.
      Nothing you set, nothing to change.)*
- [ ] **Privacy nutrition labels must match the reply**: phone number (account),
      coarse+precise location (app functionality), photos (app functionality),
      purchase history (app functionality). Nothing marked "tracking". A
      mismatch between the labels and the written answer re-opens 2.1.

---

## 5b. Free at launch — what changes

Planned: ship free, enable iyzico charging after field testing.

- The payment surfaces are **still in the binary** (`app/payments.tsx`,
  `app/card-add.tsx`, `app/session-review.tsx`, `lib/iyzico.ts`), so keep the
  3.1.1 physical-goods sentence in the review notes — it's accurate and heads
  off an IAP challenge.
- ⚠️ If you strip or hide the payment UI for v1, **remove the iyzico line from
  the review notes too.** Describing a feature the reviewer can't find is its
  own 2.1 flag.
- Free pricing does **not** exempt you from 2.3.7 — "ÜCRETSİZ" still can't
  appear in a screenshot even if the app genuinely is free. See §4.
- Turning on charging later is a normal metadata/backend change; no new
  guideline exposure as long as the description covers it.

---

## 6. Not flagged by Apple, but check before you submit

- [ ] Privacy policy URL and Support URL resolve (KVKK text live).
- [ ] iyzico / external-payment disclosure is in the description.
- [ ] Export compliance: `ITSAppUsesNonExemptEncryption: false` is set. ✅

---

## Order of operations

1. Decide rename (§2) — if you're renaming, do it now, before anything else.
2. Replace the "ÜCRETSİZ" screenshot in ASC (§4); delete the iPad screenshot set.
3. Assemble the 5.2.1 evidence PDF (§2) — manual + parts photo + hardware video
   + domain proof + signed declaration.
4. Cut a fresh production build — needed for `supportsTablet: false` and to
   confirm `cfaeddc` is embedded. Verify Demo Login on a real iPhone.
5. Shoot the 2.1 demo video against *that* build (§1), upload unlisted.
6. Check privacy nutrition labels (§5), fill App Review Information, paste
   `apple-review-reply.md`, resubmit.

---

## Before you publish the DIY handbook / design files publicly

- **File first, publish second.** TÜRKPATENT trademark and industrial design are
  first-to-file. Turkey and the EU give a 12-month grace period after your own
  disclosure; several other jurisdictions give none — publishing the case design
  destroys novelty there permanently. Your own `IP_RISK_NOTES.md` already says
  register early.
- **Keep the BLE protocol out of it.** No characteristic UUIDs, command framing,
  session-token format, or firmware auth details. The handbook should cover the
  case, mounting, and wiring — not anything that helps someone forge an unlock.
- Redact your own station IDs and Supabase URLs/keys from any screen capture in
  the video.
- Everything published stays dated and public — which is exactly why it works as
  independent-development evidence for §2.
