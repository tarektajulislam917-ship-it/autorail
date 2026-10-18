import assert from "node:assert/strict";
import test from "node:test";
import { isBlockedAddress, validatePublicUrl } from "./url-policy.js";

test("blocks private, loopback, link-local, and reserved IP addresses", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.2.3", "192.168.1.1", "169.254.169.254", "::1", "fd00::1"]) {
    assert.equal(isBlockedAddress(address), true, address);
  }
  assert.equal(isBlockedAddress("93.184.216.34"), false);
  assert.equal(isBlockedAddress("2606:2800:220:1:248:1893:25c8:1946"), false);
});

test("rejects non-web and credential-bearing URLs before DNS", async () => {
  await assert.rejects(validatePublicUrl("file:///etc/passwd"), /Only HTTP and HTTPS/);
  await assert.rejects(validatePublicUrl("http://user:pass@example.com"), /credentials/);
  await assert.rejects(validatePublicUrl("http://localhost"), /Local and private/);
  await assert.rejects(validatePublicUrl("http://127.0.0.1"), /Private and reserved/);
});

test("accepts a public URL", async () => {
  const url = await validatePublicUrl("https://93.184.216.34/path?q=1");
  assert.equal(url.href, "https://93.184.216.34/path?q=1");
});
