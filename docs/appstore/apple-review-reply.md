# Apple Resolution Center — reply draft (Submission ID 8d30c74b)

Paste this as the reply in App Store Connect after: (a) the new build with the
onboarding fix is attached, (b) the "ÜCRETSİZ" screenshot is replaced, (c) the
App Review Information fields below are filled, and (d) the authorization
documents are attached.

---

Hello, and thank you for the detailed review. We have addressed each item below.

## Guideline 2.1(a) — Full access in Demo Mode (RESOLVED in this build)
The previous build gated onboarding on granting the Bluetooth permission, which
trapped the review on the permissions screen when Bluetooth could not be
granted. In this new build no permission blocks onboarding: a user (or reviewer)
can decline Bluetooth and Location and still reach and use the entire app.

To review every feature with no physical hardware, please use Demo Mode:
1. On the first screen (Welcome), tap "Demo Login" at the bottom.
2. Enter the username: appstore
3. Tap "demo giriş".

This signs you straight in with no phone number and no SMS. Demo Mode runs a
fully simulated locker, so you can complete the entire workflow end to end:
browse stations on the map, reserve a station, unlock it, run a session, and
return/close it. No physical hardware is required at any step.

## Guideline 2.1 — Demo video of the hardware pairing
A link to a demo video filmed on a physical iPhone, showing the app pairing with
and operating a physical Playbox station end to end, is provided in the App
Review Information section (Notes / demo video URL field).

## Guideline 5.2.1 — Authorization for the "Playbox" brand and hardware
Playbox is our own product. The stations shown in the app are hardware we build
and operate; the "Playbox" name and branding are ours. We have attached
documentary evidence of ownership and authorization in the App Review
Information section (business registration, trademark filing, domain ownership,
and a signed letter of authorization). Please let us know if you need anything
further to confirm.

## Guideline 2.3.7 — Pricing reference in a screenshot
We have replaced the screenshot that contained the word "ÜCRETSİZ" (free). No
screenshot references price, "free", or discounts anymore.

## Guideline 2.1 / 1.3 — Data practices
- Third-party analytics: none. The app contains no analytics SDK (no Firebase
  Analytics, no Google Analytics, no Segment/Amplitude/AppsFlyer). No active
  crash-reporting SDK.
- Third-party advertising: none. The app shows no ads and integrates no ad
  network. This is not a kids-category app.
- Data shared with third parties: the only third party that receives user data
  is our payment processor, iyzico, and only to process a rental payment. Card
  details are entered on iyzico's side and are never seen or stored by the app.
- Data collected for other purposes: only what is needed to run the service:
  phone number (sign-in via SMS one-time code), location (to show nearby
  stations and confirm you are next to the locker you are unlocking), product
  interaction (your reservations and sessions), and an optional return photo you
  choose to attach when closing a locker. All of this is stored in our own
  Supabase backend and is not used for tracking or advertising and is not sold.

Thank you again. We are happy to provide anything else you need.

---

## App Review Information fields to fill in App Store Connect
- Sign-In required: YES
- User name: appstore
- Password: (leave blank if the field allows; Demo Login uses only the username.
  If a password is required, enter: appstore)
- Notes: paste the "Guideline 2.1(a)" steps above (the 3-step Demo Login), plus:
  "Permissions are optional; you can decline Bluetooth and Location and still use
  the whole app. Demo Mode simulates the locker so the full reserve → unlock →
  return flow works with no hardware."
- Demo video URL: (unlisted YouTube/Vimeo link — see demo-video-shotlist.md)
- Attachment: authorization documents (see authorization-letter.md)
