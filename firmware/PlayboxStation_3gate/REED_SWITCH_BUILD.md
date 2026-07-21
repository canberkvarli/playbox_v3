# Prompt for phone-Claude — wire up the 3 door sensors (reed switches)

Paste everything below the line into Claude on your phone. Start by taking
photos of: (a) one of your solenoid locks, (b) the ESP32 with its current
wiring, (c) any small sensors/magnets you already have. Attach them.

---

I'm building a 3-gate BLE equipment locker on an ESP32 (DOIT DevKit V1). The
firmware is written and working — I just need to add the physical **door-closed
sensors** and confirm my **lock mechanism** re-locks correctly. Guide me step by
step, checking my parts against photos before telling me to buy anything.

## What the system does today
- Tapping "play" in the app fires a relay for one gate → a **solenoid** pulses
  for 400ms → the latch releases and the door opens.
- The user takes the ball and **pushes the door shut**.
- The firmware needs to KNOW the door shut. It reads a **reed switch** (magnetic
  door sensor) per gate. My firmware already expects them on these ESP32 pins:
  - Gate 1 reed → **GPIO 18**
  - Gate 2 reed → **GPIO 19**
  - Gate 3 reed → **GPIO 21**
  - Each reed is wired **GPIO ↔ GND**, configured `INPUT_PULLUP` in firmware,
    so **LOW = magnet near = door closed**. No resistor needed (internal pull-up).
- Relays (already wired): Gate 1 = GPIO 13, Gate 2 = GPIO **27**, Gate 3 = GPIO 14.
- On my bench there are NO reeds yet, so I fake the "door closed" step with a
  debug button. I want to replace that with real reed switches now.

## STEP 0 — confirm the lock ORIENTATION (my solenoid is already the right type)
I have a **spring-loaded angled-tongue solenoid ("dilli solenoid"), tongue
pointing DOWN**. This is the self-relocking type — good. I do NOT need a separate
spring. The app only PULSES the coil open for 400ms and does NOT hold it, so the
lock MUST re-lock on its own when the door is pushed shut. Verify orientation with
me by hand, no power/code:
1. Push the tongue in with my finger — it should retract and spring back out
   (confirms it's spring-loaded).
2. Mount it roughly, then push the door (or my hand) against it from the
   direction the door CLOSES:
   - If the **angled/beveled face cams the tongue in and it clicks shut** →
     orientation is correct, it self-relocks. 
   - If the **flat back of the tongue blocks the door / won't close** → tell me
     to rotate the solenoid 180° so the beveled face points the way the door
     swings, then retest.
Confirm the door can be PULLED open by hand once unlocked (no push-catch needed
for a locker) before we move on.

## STEP 2 — confirm my sensor parts (from my photo)
I need, per gate (×3):
- 1 **reed switch** — a normally-open 2-wire magnetic sensor (the small glass
  tube type, or a boxed door/window alarm reed). Confirm what I have matches.
- 1 small **magnet** (neodymium is fine) that sits on the door and lines up with
  the reed on the frame when shut.
Tell me if I'm missing any and give an exact, cheap shopping list with search
terms if so.

## STEP 3 — wire ONE reed first (gate 2, my basketball example) and test
Walk me through, one wire at a time:
1. One leg of the gate-2 reed → ESP32 **GPIO 19**. Other leg → any **GND** pin.
   (Polarity doesn't matter on a reed — it's just a switch.)
2. Mount the reed on the frame and the magnet on the door so they're within
   ~10–15 mm of each other when the door is CLOSED.
3. Keep the ESP32 on USB with the Arduino Serial Monitor open at 115200.
4. When I bring the magnet to the reed (or shut the door), I should see in serial:
   `[REED] gate 2 closed (state ...)` and a state change.
   Moving the magnet away should log `[REED] gate 2 opened`.
Help me debug if it doesn't trigger (wrong pin, magnet too far, wrong reed type,
or a reed that's normally-closed instead of normally-open).

## STEP 4 — repeat for gates 1 (GPIO 18) and 3 (GPIO 21)
Same procedure. Confirm all three log correctly.

## STEP 5 — full end-to-end test
With all 3 reeds in, from the app (not the debug screen): play → door opens →
close it → the app should advance to "in use" from the REAL reed (no sim button).
Then return → close → session ends. Confirm the reed drives the whole cycle.

## STEP 6 — production flag
Once reeds work, tell me to set `#define DEV_SIM_CLOSE 0` in the firmware and
reflash, so a phone can never fake a door-closed in production.

Constraints: I'm on an ESP32 DevKit V1, powering the ESP32 from USB and the
solenoids from a separate 12V supply (shared ground). Keep it beginner-friendly,
one step at a time, and always have me verify each step in the Serial Monitor
before moving on.
