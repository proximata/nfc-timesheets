/**
 * Where a worker gets the app (see docs/LANDING-DEPLOYMENT.md). iPhone: a public TestFlight
 * link (external group). Android: the signed release APK served by this site (anyone, no
 * Google account involved), plus the Play internal-testing opt-in link, which only works for
 * Google accounts the owner has added to the tester list. Change a link here and nowhere else.
 */
export const ANDROID_APK_URL = '/downloads/nfc-timesheets.apk'
export const TESTFLIGHT_APP_URL = 'https://apps.apple.com/app/testflight/id899247664'
export const TESTFLIGHT_JOIN_URL = 'https://testflight.apple.com/join/gWkgcc9m'
export const PLAY_TEST_URL = 'https://play.google.com/apps/internaltest/4701746903518593992'
