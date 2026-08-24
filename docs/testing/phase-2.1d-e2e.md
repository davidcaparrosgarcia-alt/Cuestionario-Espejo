# Phase 2.1D browser E2E isolation

Run `npm run test:e2e`. The runner starts Firestore and Auth Emulator for the synthetic project `demo-ce-patient-harness`, starts the local application, executes Chromium serially, and tears the processes down through `firebase emulators:exec` and Playwright's `webServer` lifecycle.

The browser Firebase client requires `VITE_E2E_FIREBASE_EMULATOR=true`, a local browser origin, the exact demo project ID, explicit local Firestore/Auth hosts, and explicit ports. A mismatch throws `E2E SAFETY ABORT`; there is no fallback to the production Firebase configuration.

The patient path uses Firestore and initializes Auth. Both are emulated. Storage is initialized with a synthetic `.invalid` bucket because application startup exports it, but this anonymous patient flow performs no Storage operation, so no Storage Emulator is started.

The Playwright route firewall permits only `localhost` and `127.0.0.1`. E2E-only HTML transformation removes Google Fonts and Font Awesome CDN links. The following local API side effects are fulfilled deterministically in-browser:

- `/api/notify-soybienestar-status`
- `/api/generate-patient-report`
- `/api/notify-questionnaire-completed`

The final `https://soybienestar.es/herramientas` navigation is captured as an expected redirect intent and aborted before outbound traffic. Every other external URL is recorded as a violation, aborted, and fails the test. `console.error`, `pageerror`, and unexpected `requestfailed` events also fail tests.

Browser speech synthesis and media playback are replaced only through Playwright initialization to avoid nondeterministic audio. Product code and patient semantics are unchanged.

The captured legacy behavior for a `completed` patient is an immediate locked screen after Firestore hydration, before PIN entry. This baseline is intentional and documents the pre-migration behavior.
