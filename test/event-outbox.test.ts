import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { Scheduler } from "../src/scheduler.ts";

test("trusted event spools retry failures, exclude overlapping deliveries and acknowledge success", { timeout: 10000 }, async () => {
 const root = mkdtempSync(join(tmpdir(), "nano-events-"));
 try {
  const queue = join(root, "events"); mkdirSync(queue);
  const config = loadConfig({ NANO_CHANNEL:"stdin", NANO_OWNER:"user@example.com", NANO_DATA_DIR:join(root,"data"), NANO_EVENT_OUTBOX_DIRS:queue });
  const path=join(queue,"fixture.json");writeFileSync(path,JSON.stringify({kind:"task",text:"fixture event"}));
  let calls=0; let release:()=>void=()=>{}; let entered:()=>void=()=>{};
  const started=new Promise<void>(resolve=>entered=resolve);
  const hold=new Promise<void>(resolve=>release=resolve);
  const scheduler=new Scheduler(config,{send:async()=>{},background:async()=>{},task:async()=>{calls++; if(calls===1)throw new Error("temporary delivery failure");entered();await hold;}});
  await scheduler.tick();assert.ok(existsSync(path));
  const retry=scheduler.tick();await started;
  await scheduler.tick();assert.equal(calls,2);
  release();await retry;
  assert.ok(!existsSync(path));assert.ok(existsSync(join(queue,"fixture.done")));
  writeFileSync(path,JSON.stringify({kind:"task",text:"duplicate event"}));
  await scheduler.tick();assert.equal(calls,2);assert.ok(!existsSync(path));
  writeFileSync(join(queue,"invalid.json"),"not json");await scheduler.tick();assert.ok(existsSync(join(queue,"invalid.json.bad")));
 } finally {rmSync(root,{recursive:true,force:true});}
});
