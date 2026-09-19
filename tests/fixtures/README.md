# Isolated X browser fixture

`browser-bridge-smoke.js` exercises the real extension and packaged MAIN-world runner against this local HTTPS server. Chrome can start extension-created tabs before Playwright attaches request interception, so DNS routing supplies the fixture even for their first navigation. No real X login is used.

1. Build the extension and run the website locally on port 4318.
2. Create a temporary directory, then generate its certificate with `openssl req -x509 -newkey rsa:2048 -nodes -keyout <directory>/key.pem -out <directory>/cert.pem -days 1 -subj /CN=x.com`.
3. Start `node tests/fixtures/x-server.mjs <directory>`.
4. Launch a new isolated persistent Chromium profile with the unpacked extension and these additional arguments:
   - `--no-proxy-server`
   - `--ignore-certificate-errors`
   - `--host-resolver-rules=MAP x.com 127.0.0.1:18443, MAP upload.x.com 127.0.0.1:18443, MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1`
5. Run `playwright-cli -s=<session> run-code --filename=tests/browser-bridge-smoke.js` from the local website tab. The test checks the fixture page before adding a synthetic CSRF cookie. All navigation and API counts come from the fixture server.
6. Close that browser and stop the fixture and local website servers. Remove only the temporary certificate directory created for this test.

Use these routing/certificate overrides only in this isolated test profile. The production extension has no test hooks or fixture URLs.
