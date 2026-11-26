import { test } from "node:test";
import assert from "node:assert/strict";
import { templates } from "@/lib/notify/templates";
import { addressCustomer } from "@/lib/notify/address";
import { normaliseMobile, parseLatLng, maskMobile } from "@/lib/validation";
import { sunState, sunDirection, dayLight, compassPoint } from "@/lib/scene/sun";
import { istDate, istHour } from "@/lib/time";
import { sniffModelFormat } from "@/lib/upload";

const RESPECTFUL = /^Dear (Mr\.|Mrs\.|Ms\.|Dr\.) \S|^Dear Sir\/Ma'am/;

test("every customer template opens with a respectful address", () => {
  for (const sal of ["MR", "MRS", "MS", "DR", "NONE"] as const) {
    const c = { customerName: "Amit  Roy", customerSalutation: sal };
    const all = [
      templates.otp(c, { code: "123456", minutes: 10 }),
      templates.reportReady(c, { projectCode: "EGS-2026-0001", systemSizeKw: 5, version: 1, link: "https://x/p/abc" }),
      templates.commentReply(c, { projectCode: "EGS-1", link: "l" }),
      templates.meetingBooked(c, { when: "Mon 1 Dec, 11:00 AM IST", designer: "Ananya", link: "l" }),
      templates.meetingReminder(c, { when: "w", lead: "tomorrow", link: "l" }),
      templates.meetingCancelled(c, { when: "w", link: "l" }),
      templates.newVersion(c, { projectCode: "EGS-1", version: 2, link: "l" }),
      templates.approved(c, { projectCode: "EGS-1", version: 2 }),
    ];
    for (const r of all) {
      assert.match(r.text, RESPECTFUL, r.text);
      assert.equal(r.params[0], addressCustomer(c));
    }
  }
  assert.equal(addressCustomer({ customerName: " Rina  Das ", customerSalutation: "MRS" }), "Mrs. Rina Das");
  assert.equal(addressCustomer({ customerName: "X", customerSalutation: "NONE" }), "Sir/Ma'am");
});

test("mobile numbers normalise to +91", () => {
  assert.equal(normaliseMobile("98300 12345"), "+919830012345");
  assert.equal(normaliseMobile("098300-12345"), "+919830012345");
  assert.equal(normaliseMobile("+91 98300 12345"), "+919830012345");
  assert.equal(normaliseMobile("919830012345"), "+919830012345");
  assert.equal(normaliseMobile("12345"), null);
  assert.equal(normaliseMobile("+9112345678"), null);
  assert.equal(maskMobile("+919830012345"), "+91 98••••••45");
});

test("coordinates parse from text and Google Maps links", () => {
  assert.deepEqual(parseLatLng("22.5726, 88.3639"), { lat: 22.5726, lng: 88.3639 });
  assert.deepEqual(parseLatLng("22.5726° N, 88.3639° E"), { lat: 22.5726, lng: 88.3639 });
  assert.deepEqual(parseLatLng("https://www.google.com/maps/place/X/@22.6213,88.4231,17z"), { lat: 22.6213, lng: 88.4231 });
  assert.deepEqual(parseLatLng("https://maps.google.com/?q=22.57,88.36"), { lat: 22.57, lng: 88.36 });
  assert.equal(parseLatLng("hello"), null);
});

test("IST helpers", () => {
  const d = istDate(2026, 6, 21, 12.5);
  assert.equal(d.toISOString(), "2026-06-21T07:00:00.000Z");
  assert.equal(istHour(d), 12.5);
});

test("sun position for Kolkata is physically sensible", () => {
  const [lat, lng] = [22.5726, 88.3639];
  // Summer solstice noon: sun almost overhead (Kolkata is just south of the Tropic of Cancer)
  const summer = sunState(istDate(2026, 6, 21, 11.6), lat, lng);
  assert.ok(summer.altitudeDeg > 85, `summer alt ${summer.altitudeDeg}`);
  // Winter solstice noon: ~44° high, due south
  const winter = sunState(istDate(2026, 12, 21, 11.5), lat, lng);
  assert.ok(Math.abs(winter.altitudeDeg - 44) < 2, `winter alt ${winter.altitudeDeg}`);
  assert.equal(compassPoint(winter.azimuthDeg), "S");
  // Direction vector: south = +Z, up = +Y in model space
  assert.ok(winter.direction[2] > 0.6 && winter.direction[1] > 0.6);
  // Morning sun is in the east (+X)
  assert.ok(sunState(istDate(2026, 3, 20, 8), lat, lng).direction[0] > 0.5);
  // North offset rotates the frame: model north pointing east (90°) → true east appears as model north (−Z)
  const [x, , z] = sunDirection(0, 90, 90);
  assert.ok(Math.abs(x) < 1e-9 && Math.abs(z + 1) < 1e-9);
  // Day length
  const dl = dayLight(2026, 12, 21, lat, lng);
  assert.ok(dl.sunrise > 6 && dl.sunrise < 6.5 && dl.sunset > 16.7 && dl.sunset < 17.1, JSON.stringify(dl));
});

test("model format sniffing", () => {
  assert.equal(sniffModelFormat(Buffer.from("glTF\x02\x00\x00\x00")), "GLB");
  assert.equal(sniffModelFormat(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0])), "ZIP");
  assert.equal(sniffModelFormat(Buffer.from('<?xml version="1.0"?><COLLADA xmlns="x" version="1.4.1">')), "DAE");
  assert.equal(sniffModelFormat(Buffer.from("hello")), null);
});

test("approval record hash is stable and tamper-evident", async () => {
  const { recordHash, verifyRecord, consentText } = await import("@/lib/approval");
  const f = {
    projectId: "p", versionId: "v", versionNumber: 2, customerName: "Amit Roy", customerMobile: "+919800000001",
    consentText: consentText({ customerName: "Amit Roy", address: "12 Lake Rd,  Kolkata" }, 2), videoSha256: "ab", videoBytes: 1000,
    videoMime: "video/webm", otpChallengeId: "o", ip: "1.2.3.4", userAgent: "UA", approvedAt: new Date("2026-11-26T10:00:00Z"),
  };
  assert.equal(f.consentText, "I, Amit Roy, have reviewed design Version 2 for 12 Lake Rd, Kolkata. Please install the system exactly as shown.");
  const row = { ...f, id: "a", videoKey: "k", deviceInfo: {}, recordHash: recordHash(f) } as never;
  assert.ok(verifyRecord(row));
  assert.ok(!verifyRecord({ ...(row as object), videoBytes: 999 } as never), "edited record is detected");
});
