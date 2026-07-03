# PlayBox — IP risk notes (Turkey)

Not legal advice. I'm not a lawyer. This is background to take to a Turkish IP attorney (marka/patent vekili) before you spend real money or scale. The numbers and facts below are from public sources (June 2026); confirm anything load-bearing with counsel and a proper search.

## First: you can't get "copyrighted"

Copyright protects creative works (their app's source code, their photos, their graphic art, their written copy). As long as you don't copy those, copyright is the *least* of your worries. The real risk buckets for a physical product + app like this are:

1. **Trademark** — their name "Equip", logo, and look-as-brand. Highest practical risk if you copy their identity.
2. **Registered design (industrial design)** — the specific visual shape/appearance of their locker, if they registered it.
3. **Patents / utility models** — a specific technical mechanism or method (e.g. a particular app-to-locker unlocking system), if claimed and granted.
4. **Unfair competition** — a catch-all in the Turkish Commercial Code that can bite even when nothing is registered, if you're seen to be riding on someone else's reputation or causing confusion.

The general *idea* — "an app-unlocked self-service ball locker" — is not ownable by anyone. Ideas and concepts aren't protected. Specific names, specific designs, and specific patented mechanisms are.

## Who Equip is

- **Equip club S.A.**, a Swiss startup (Vaud, Switzerland), part of the **Nidecker group**. Self-service sports-equipment locker + app.
- Deeply **partnered with Decathlon** (Paris, London, Switzerland launches) and working with FIBA, Canadian Tire Jumpstart, City of Ottawa, etc. Backed and well-resourced, expanding internationally.
- Takeaway: this is a funded company with a corporate partner, not a hobby project. They have the means to register and enforce IP. Assume they will protect their brand and design in markets they care about, and possibly file internationally via the Madrid (trademark) and Hague (design) systems, which both reach Turkey.

## What's likely protectable on their side

- **The "Equip" word mark and logo** — almost certainly their core registered asset (Class 28 sporting goods + Class 35/39/42 type services for rental/app). Do not reuse the name or anything close.
- **Their visual identity** — navy body + orange accents, "RENT YOUR GEAR", the three-glass-door tower look, the Decathlon co-branding. Some of this may be registered design and/or protected as trade dress / unfair-competition.
- **Patents in this space** — there is at least one granted US patent for "System and apparatus for automated sporting equipment rentals" (US11694495) and related "automated rental systems" patents. I could not confirm the owner of that specific one (Equip vs a third party). Either way, it means **the automated-rental-locker field has patents in it**, so a freedom-to-operate (FTO) check on the *mechanism* you ship is worth doing before scaling, independent of Equip.

## Turkey specifics (TURKPATENT)

- **First-to-file.** Turkey rewards whoever registers first. File your own brand and design **early**.
- **Industrial design** registration protects a product's appearance, up to **25 years**. If you design a distinctive look and register it, that's your shield and your sword.
- **Utility model** — protects a new, industrially-applicable invention without needing an inventive step, **10 years**. Cheaper/faster than a full patent; relevant if you invent a specific mechanism.
- **Patent** — full invention protection, 20 years, needs inventive step.
- **Unfair competition (Commercial Code).** Even an **unregistered or foreign** mark/design can get protection in Turkey if it's established/known and you're causing confusion or free-riding. So "Equip hasn't registered in Turkey yet" is **not** a safe assumption, especially as a Decathlon-partnered brand with press coverage.

## Practical do / don't

**Don't (these are where you actually get sued):**
- Don't use the name **Equip**, or anything confusingly similar, anywhere — product, app, company, domain, store listing.
- Don't copy their **navy+orange + glass-tower** identity, their taglines ("Rent Your Gear"), their icon/app UI, or any Decathlon co-branding.
- Don't copy their **app code, graphics, copy, or photos** (that's the copyright line).
- Don't replicate a **specific patented unlocking mechanism** if an FTO search turns one up. Your BLE-direct-to-ESP32 + solenoid approach is generic and likely fine, but confirm.

**Do (these make you defensible and ownable):**
- Pick your **own brand name, logo, colors, and look**. Make the tower visually your own (different proportions, colors, door style, branding). Differentiation is both legally safer and better business.
- **Register early with TURKPATENT**: your trademark (word + logo) and your industrial design (the locker's appearance). First-to-file.
- If you invent a genuinely novel mechanism, consider a **utility model** (fast, cheap) in your own name.
- Before you scale or take money, get a **freedom-to-operate / clearance search** from a Turkish patent attorney: trademark search ("Equip" + your proposed name), design search, and a patent/utility-model search for app-unlock locker mechanisms (incl. Madrid/Hague filings that reach Turkey).
- Keep your own **dated records** (design files, firmware commits, photos) proving independent development. Your git history already helps here.

## The honest bottom line

Building a competing self-service sports locker in Turkey is legal — the category isn't owned. You get into trouble by **looking like Equip, being named like Equip, or copying a specific protected mechanism**. Make it visibly your own product, register your own brand + design first, and do one FTO search with a Turkish IP attorney before you scale or raise money. That combination is what keeps "we made a lot of money" from turning into "and then we got a cease-and-desist."

## Sources

- Equip + Decathlon, Swiss startup / Nidecker, expansion: startupticker.ch, trendwatching.com, decathlon.co.uk, FIBA, CBC (Ottawa)
- Patents in the space: USPTO US11694495 "System and apparatus for automated sporting equipment rentals"; related automated-rental patents
- Turkey IP (TURKPATENT, designs, utility models, unfair competition): akkaslaw.com, worldtrademarkreview.com, istanbulattorneys.com, gov.uk IP-in-Turkey
- WIPO Madrid (trademark) and Hague (design) systems reach Turkey: wipo.int
