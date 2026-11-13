import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

test('AgentMail handoff reuses reconciliation, publishes atomically, deduplicates pending/acknowledged events and omits content',()=>{
 const script=String.raw`
import importlib.util, json, tempfile, types, pathlib, os
spec=importlib.util.spec_from_file_location('handoff','packs/agentmail/lib/handoff.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as queue:
 thread=types.SimpleNamespace(thread_id='fixture-thread',subject='private subject',preview='private message',last_message_id='fixture-message')
 monitor=types.SimpleNamespace(thread_fingerprint=lambda t:t.last_message_id,create_kanban_task=None)
 module.install(monitor,inbox_id='user@example.com',queue_dir=queue)
 assert monitor.create_kanban_task(thread,'new_message')
 paths=list(pathlib.Path(queue).glob('*.json'));assert len(paths)==1
 payload=json.loads(paths[0].read_text());assert payload['kind']=='task'
 assert 'private subject' not in payload['text'] and 'private message' not in payload['text']
 assert 'fixture-thread' in payload['text'] and 'required Link approval' in payload['text']
 assert paths[0].stat().st_mode & 0o777 == 0o600
 assert monitor.create_kanban_task(thread,'new_message');assert len(list(pathlib.Path(queue).glob('*.json')))==1
 paths[0].rename(paths[0].with_suffix('.done'))
 assert monitor.create_kanban_task(thread,'new_message');assert not list(pathlib.Path(queue).glob('*.json'))
 thread.last_message_id='new-version';assert monitor.create_kanban_task(thread,'new_message')
 assert len(list(pathlib.Path(queue).glob('*.json')))==1
 assert not list(pathlib.Path(queue).glob('.pending-*'))
print('ok')
`;
 assert.equal(execFileSync('python3',['-c',script],{encoding:'utf8'}).trim(),'ok');
});
