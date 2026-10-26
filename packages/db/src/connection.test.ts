import assert from "node:assert/strict";
import test from "node:test";
import { withConnectTimeout } from "./connection.js";

test("adds connect_timeout and keeps existing params", () => {
  const url = withConnectTimeout(
    "postgresql://u:p@ep-x.neon.tech/neondb?sslmode=require",
  );
  const parsed = new URL(url!);
  assert.equal(parsed.searchParams.get("sslmode"), "require");
  assert.equal(parsed.searchParams.get("connect_timeout"), "15");
  assert.equal(parsed.password, "p");
});

test("an explicit connect_timeout wins", () => {
  const raw = "postgresql://u:p@host/db?connect_timeout=30";
  assert.equal(withConnectTimeout(raw), raw);
});

test("leaves missing or unparseable URLs alone", () => {
  assert.equal(withConnectTimeout(undefined), undefined);
  assert.equal(withConnectTimeout("not a url"), "not a url");
});
