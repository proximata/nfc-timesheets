/**
 * Where a worker gets the app. Both are TEST tracks, not store listings (see
 * docs/LANDING-DEPLOYMENT.md): iPhone through a public TestFlight link (external group),
 * Android through the Play internal-testing opt-in link, which only works for Google accounts
 * the owner has added to the tester list. Change a link here and nowhere else.
 */
export const TESTFLIGHT_APP_URL = 'https://apps.apple.com/app/testflight/id899247664'
export const TESTFLIGHT_JOIN_URL = 'https://testflight.apple.com/join/gWkgcc9m'
export const PLAY_TEST_URL = 'https://play.google.com/apps/internaltest/4701746903518593992'
