# Demo video shot list — 3rd submission (Aug 2026)

Apple has now asked for this **twice**. The July 10 and August 7 messages use the
same words, and the one phrase that keeps failing is:

> "The **initial pairing process** between the app and the designated hardware"

The previous video started at "app already sees the station". That is the gap.
Apple must watch the phone FIND the hardware on camera.

## Non-negotiables

1. **One continuous take.** No cuts. A cut is where a reviewer assumes the magic
   happened off-camera.
2. **Film with a second camera** so the physical iPhone AND the locker are in the
   same frame the whole time. A screen recording alone will be rejected — they
   asked for "a physical Apple device, not a simulator" twice.
3. **Current build (45).** The last video was an older build with a lighter
   theme; they explicitly ask for "the current version of the app in use".
4. **Real account, NOT Demo Mode.** Demo Mode bypasses BLE entirely, so it
   proves nothing about hardware. Demo Mode is the answer to 2.1(a), not to this.
5. Narrate in English as you go, or add captions. Don't make them infer.

## Shot list

| # | What's on camera | Why it's here |
|---|---|---|
| 1 | Say the date + "iPhone <model>, build 45". Show the phone is a real device (lock screen, then open app). | "physical Apple device, current version" |
| 2 | **Station powered OFF.** Show the map: station reads kapalı / offline. | Establishes the app is not faking it |
| 3 | **Power the station ON, in frame.** Show the blue LED start blinking. | Hardware is real and you just energised it |
| 4 | Wait, without touching the phone, until the map flips to **açık**. | ★ THIS IS THE "PAIRING" SHOT — the app discovering the hardware over BLE, unprompted, on camera |
| 5 | If the Bluetooth permission prompt appears, grant it in frame. | iOS-side pairing consent |
| 6 | Tap the station → choose Voleybol → choose duration. | Start of workflow |
| 7 | Tap to unlock. Show the **solenoid retracting and the door opening** in the same frame as the phone. | "interacting during the use of the app" |
| 8 | Let the active session run a few seconds — timer visible. | "entire app workflow" |
| 9 | End the session; show the amount charged (e.g. 1,77 TL). | Proves it's a physical-equipment rental (supports 3.1.1(a)) |

**Not filmed in the round-3 video, and deliberately not claimed in the reply:**
the reed-switch door-close detection. Apple's ask is BLE pairing + the app
driving the hardware, and steps 3–6 cover that. Do not describe the reed work in
the reply unless it is on camera — an over-claimed step a reviewer can't find is
worse than a shorter, accurate list.

Steps 2–4 are the entire reason this was rejected twice. If you film nothing
else differently, film those.

## Notes

- **Showing the money is fine and actually helps.** Guideline 2.3.7 was about
  *App Store screenshots*, not the app or a video. A visible charge for renting
  a physical ball reinforces that this is outside In-App Purchase.
- Upload somewhere with no login wall (Streamable was accepted before). Put the
  link in **App Review Information** in App Store Connect *as well as* in the
  reply message.
- Keep it under ~3 minutes. Reviewers are not going to watch ten.
