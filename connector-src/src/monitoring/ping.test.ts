import assert from "node:assert/strict";
import test from "node:test";
import { parsePing } from "./ping.js";

test("parses unreachable Linux ping output with reported errors", () => {
  const result = parsePing(
    `PING 172.31.0.20 (172.31.0.20) 56(84) bytes of data.
From 172.31.0.166 icmp_seq=1 Destination Host Unreachable

--- 172.31.0.20 ping statistics ---
5 packets transmitted, 0 received, +3 errors, 100% packet loss, time 4085ms
pipe 3`,
    "172.31.0.20",
    "2026-07-29T21:00:00.000Z",
  );
  assert.equal(result.sent, 5);
  assert.equal(result.received, 0);
  assert.equal(result.packetLossPercent, 100);
  assert.equal(result.reachable, false);
});
