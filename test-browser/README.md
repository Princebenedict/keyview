Optional real-browser check. It starts the server, opens the landing page and the app in headless Chromium at desktop and phone width, and asserts: no console errors, no sideways scroll, the key toggle, the scroll-driven diagram, the countdown ring, the FAQ, and reduced-motion handling.

1. cd test-browser
2. npm install (downloads a bundled Chromium, about 60 MB)
3. npm test
