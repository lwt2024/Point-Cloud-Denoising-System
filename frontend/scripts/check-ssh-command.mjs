import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSshCommand } from "../src/ssh-command.ts";
test("parses AutoDL SSH commands without executing them", () => {
  assert.deepEqual(parseSshCommand("ssh -p 30901 root@connect.example.com"), {
    host: "connect.example.com",
    port: 30901,
    username: "root",
  });
  assert.deepEqual(parseSshCommand("ssh user@example.com -p2222"), {
    host: "example.com",
    port: 2222,
    username: "user",
  });
  assert.deepEqual(parseSshCommand("ssh -l alice host.example.com"), {
    host: "host.example.com",
    port: 22,
    username: "alice",
  });
});
test("rejects remote commands, shell operators, SSH options and invalid ports", () => {
  for (const command of [
    "ssh user@host touch /tmp/x",
    "ssh -o ProxyCommand=evil user@host",
    "ssh user@host;evil",
    "ssh -p 0 user@host",
    "ssh -p nope user@host",
    "ssh -p 70000 user@host",
    "ssh user@host && evil",
    "ssh root@bad@host",
  ])
    assert.throws(() => parseSshCommand(command));
});
