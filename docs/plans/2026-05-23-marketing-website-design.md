# Playbox Marketing Website — Design

**Date:** 2026-05-23
**Status:** Approved, ready for implementation
**Repo:** `~/Development/playbox-web` (new, separate from `playbox_v3`)
**Deploy:** Vercel (preview URL initially; custom domain TBD)

---

## Goal

A single-page marketing site for Playbox Türkiye with balanced dual-CTA:
download the app (coming soon) and become a partner. Inspired by
[equip.sport](https://equip.sport) — confident, simple, athletic, eye-catching.

Audience: end-users (Gen-Z / millennial Turkish players) and partners
(venue owners, sponsors, international investors).

---

## Voice & Tone

Match the app's lingo: imperative, peer energy, all-caps single-word
punches (`OYNA`), informal `sen`, zero corporate softening. No `lütfen`,
no `sayın`, no apology tone. Punchy, noun-forward, short sentences.

- TR primary (default), EN as subtle toggle in nav top-right
- EN copy preserves the energy — "PLAY", "Let's do this", "You crushed it"
  — not literal translation

Reference Turkish phrases from the app: `OYNA`, `başla`, `hadi başlayalım`,
`iyi oynadın`, `seri yap`, `iade et`.

---

## Stack

- **Next.js 15** (App Router, RSC, TypeScript) on **Vercel**
- **Tailwind CSS v4** with palette mirrored as semantic tokens
- **shadcn/ui** — Radix primitives, source-owned, fully styleable
- **Motion** (ex-Framer Motion) — micro-interactions, scroll fades
- **GSAP** (free post-Webflow) — hero text reveal, scroll-pinned moments,
  number count-ups
- **Lenis** — smooth scroll
- **Embla Carousel** — sport scroller on mobile
- **react-wrap-balancer** — headline line-break perfection
- **Lucide** icons (UI) + **Phosphor** duotone (3-step explainer)
- **Sonner** — toast feedback
- **vaul** — mobile nav drawer
- **next/font/google** — Bebas Neue / Instrument Serif / Inter, self-hosted
- **Zod** + **react-hook-form** — partner form
- **Resend** SDK — partner inquiry emails
- **@vercel/og** — auto-generated OG images
- **Vercel Analytics** — privacy-friendly, zero config

---

## Visual System

### Palette (from `playbox_v3/constants/theme.ts`)

| Token | Hex | Usage |
|-------|-----|-------|
| `bg-paper` | `#ffffff` | Soft sections, paper text |
| `bg-ink` | `#1a1f3a` | Default background, primary text |
| `text-coral` | `#e87527` | Single action color, CTAs, accents |
| `text-mauve` | `#a85a8e` | Reserved — logo highlight only |
| `bg-butter` | `#f5d4b8` | Warm break sections (Partner block) |

**Default mode:** ink background, paper text, coral as the only action color.

### Typography

- **Bebas Neue** — display, 96–160px hero, 48–72px section headers.
  All-caps, -0.02em tracking.
- **Instrument Serif** — editorial subheads, 24–32px. Italic accents.
- **Inter** — body 16–18px, UI 14px.

### Motion vocabulary (kept tight)

- Hero: GSAP SplitText letter-by-letter reveal on load + subtle breathing
  bg gradient
- Lenis smooth scroll throughout
- Scroll-triggered fades: 24px upward, 0.6s ease-out (via Motion)
- Buttons: magnetic hover on coral CTA (~6px cursor pull), 100ms press-scale
- Section transitions: horizontal coral underline draws across on enter
- Numbers: GSAP count-up on scroll
- Sports grid: Embla scroller mobile, static grid desktop with hover zoom

---

## Page Structure (single page, scroll-driven)

### 1. Nav
`PLAYBOX` wordmark (Bebas, coral) left.
Right: `Nasıl Çalışır` · `Partner` · `Uygulama` · `EN`
Mobile: vaul drawer.

### 2. Hero (ink background)
```
OYNAMAYA
HAZIR MISIN?
```
Subhead (Instrument Serif): *"Şehrin her köşesinde, cebinden çıkan bir spor sahası."*
CTAs: `UYGULAMAYI İNDİR` (coral solid) + `PARTNER OL` (paper outline)

### 3. Nasıl Çalışır
3 Phosphor duotone icons + numbered steps:
- `01 BUL` — yakındaki istasyonu bul
- `02 AÇ` — Bluetooth ile kapı açılır
- `03 OYNA` — oyna, ekipmanı iade et, seri yap

### 4. Sporlar
Embla scroller (mobile) / static grid (desktop):
- 🏀 BASKETBOL
- ⚽ FUTBOL
- 🎾 TENİS
- `YAKINDA DAHA FAZLASI` tag

Each card: full-bleed coral block, sport name in Bebas, hover image-zoom.

### 5. For Players
Split layout. Left: phone mockup (stylized SVG placeholder until real
screens). Right: editorial Instrument Serif headline — *"Seri yap. İyi oyna.
Tekrar gel."* Bullet features. App Store / Play Store buttons with greyed
`YAKINDA` badge until launch.

### 6. For Partners (butter background — warmth break)
Headline: `MEKANINA PLAYBOX GETİR.`

Three benefit cards:
- Gelir paylaşımı
- Sıfır kurulum maliyeti
- Yeni müşteri trafiği

Form (right column or below):
- ad
- mekan tipi (dropdown: kafe, spor salonu, park, okul, otel, diğer)
- email
- kısa mesaj (max 500 chars)

Submit → Sonner success toast, form clears.

### 7. FAQ
shadcn Accordion, 8 questions:
- Nerede istasyon var?
- Nasıl ödeme yapıyorum?
- Ekipman güvenli mi?
- Hangi sporları oynayabilirim?
- Uygulama ne zaman çıkıyor?
- Partner olmak ne kadar sürer?
- Hangi şehirlerdesiniz?
- Sorum başka — kime sorarım?

### 8. Footer
Wordmark + tagline + nav repeat + email contact + `TR | EN` + copyright.
No social icons (not yet established).

---

## Partner Form Wiring

- `components/partner-form.tsx` — client, react-hook-form + Zod:
  ```ts
  z.object({
    name: z.string().min(2).max(80),
    venueType: z.enum(['cafe', 'gym', 'park', 'school', 'hotel', 'other']),
    email: z.string().email(),
    message: z.string().max(500).optional(),
  })
  ```
- `app/api/partner/route.ts` — POST handler:
  1. Parse + validate body
  2. Rate-limit by IP (3 / hour) via `@vercel/edge`
  3. Format HTML email, send via Resend to `canberkvarli@gmail.com`
  4. Return `{ ok: true }` or generic `{ error }`

**Env vars** (Vercel + `.env.local`):
```
RESEND_API_KEY=...
PARTNER_INBOX=canberkvarli@gmail.com
```

---

## SEO & Performance

- Next.js Metadata API: TR + EN `<title>`, descriptions
- OG image auto-generated with `@vercel/og` — Bebas wordmark on ink
- JSON-LD: Organization + LocalBusiness
- Lighthouse target: 100/100/100/100
- Self-hosted fonts via `next/font` — zero CLS, zero external requests
- `next/image` for any future photos
- No client JS in static sections (RSC)

---

## What's Explicitly OUT of v1

- City selector in partner form (Istanbul only for now)
- Social media links (no accounts yet)
- Founders / team section (just two of us)
- Real photos (typographic hero instead)
- Blog / news / press
- Live station map (until enough stations exist)
- Multiple routes — single page only
- CMS — copy in code is fine at this scale
- Dark/light toggle — ink mode is the brand

---

## Out-of-scope but worth noting

- Custom domain — buy `playbox.com.tr` or similar when ready to share publicly
- Real social handles when @playbox accounts are created
- App Store / Play Store links when app ships
- Adding a `/blog` or `/cases` route as content grows

---

## File layout (target)

```
playbox-web/
├── app/
│   ├── (marketing)/
│   │   ├── page.tsx              # full single-page layout
│   │   └── layout.tsx            # nav + footer wrapper
│   ├── api/
│   │   └── partner/route.ts      # Resend handler
│   ├── opengraph-image.tsx       # @vercel/og dynamic OG
│   ├── layout.tsx                # root, fonts, lang
│   └── globals.css
├── components/
│   ├── nav.tsx
│   ├── hero.tsx
│   ├── how-it-works.tsx
│   ├── sports.tsx
│   ├── for-players.tsx
│   ├── for-partners.tsx
│   ├── partner-form.tsx
│   ├── faq.tsx
│   ├── footer.tsx
│   ├── lang-toggle.tsx
│   └── ui/                       # shadcn primitives
├── lib/
│   ├── i18n.ts                   # tr + en dictionaries, useLanguage()
│   ├── motion.ts                 # shared motion presets
│   └── utils.ts                  # cn(), etc.
├── tailwind.config.ts
├── next.config.ts
└── package.json
```
