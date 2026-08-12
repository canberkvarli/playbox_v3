# Reply to App Review — Guideline 2.2 (Beta Testing)

> **Fill in before sending — do not send with placeholders.**
> `<N>` = number of stations physically installed and operating
> `<VENUE, CITY>` = the real venue name + city of at least one installed station
> `<MONTH YEAR>` = when the first station went into service
>
> Everything else is accurate against build 46.

---

Hello,

Thank you for the review. I understand the concern, and I think I caused it
myself. Let me correct it directly.

**Playbox Sport is not a concept demonstration.** It is an operating equipment
rental service. There are `<N>` Playbox stations physically installed and in
service in Turkey — the first went live in `<MONTH YEAR>` at `<VENUE, CITY>`.
Each is a locker I designed and built, mounted at a public sports court, holding
footballs, basketballs and volleyballs. Members of the public walk up, rent a
ball through the app for a set duration, the locker opens, and they are charged
through iyzico, a licensed Turkish payment provider, when the session ends.
The rentals are real, the money is real, and the hardware is bolted to a wall
at a real court.

**Why the app looked like a demonstration, and what I changed.**

In the earlier rounds of this review I was asked, under Guideline 2.1(a), to
provide a way to exercise the full app without the physical locker present. I
built that — but I built it in the most visible way possible, and that was my
mistake. The build you reviewed had a red "DEMO" badge pinned to the top of
every screen, a "Demo Login" link on the first screen every user sees, and it
placed the reviewer at a station named "Playbox Dev Workshop". Session copy read
"demo session is free". Looking at those screens, your conclusion was the
correct one to draw. The app was presenting itself as a demonstration, because
I had made the review scaffolding part of the product.

In the build attached to this submission, all of it is gone:

- The "DEMO" badge is removed from the app entirely.
- The "Demo Login" entry point is removed from the welcome screen. There is now
  no user-facing way to reach a simulated state — no button, no link, no hidden
  gesture.
- The station formerly labelled "Playbox Dev Workshop" now carries its real
  venue name.
- All "demo" and "free session" wording is removed. Every user, including the
  review account, sees the same production copy and the same live pricing
  in Turkish Lira.

**How to review it without a locker.**

Review access is now an ordinary account, not a mode. Sign in on the normal
phone-number screen with:

    Phone: +90 500 000 0000
    Code:  123456

No SMS is sent to that number; the code above always works. The account then
behaves exactly like any customer account — the same map, the same reservation
flow, the same pricing, the same session timer, the same return step. The only
difference, which is invisible on screen, is that this one account's unlock
command is answered by a software stand-in for the locker instead of a physical
one, so the flow completes end to end with no hardware in the room. Nothing in
the interface announces this, because it is not a feature of the product — it
is only how this single account is provisioned for your review.

Any other account, including any member of the public, gets the real Bluetooth
driver and needs to be standing at a real locker to open a door.

I appreciate your patience across these rounds. If anything in the app still
reads as a demonstration rather than a product, please tell me which screen and
I will correct it.

Thank you,
Canberk Varli
