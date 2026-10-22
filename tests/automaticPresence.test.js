import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { presenceGit } from './helpers.js';
import { publishPresence } from '../src/cli/publicPresence.js';
import { reportPresence } from '../src/cli/presenceCommand.js';
import { claimPresence } from '../src/cli/claimPresence.js';
import { presencePolicy } from '../src/cli/presencePolicy.js';
import { displayResult } from '../src/cli/output.js';

function fixture(policy = { version: 1, repository: 'example/project', origin: 'https://example.org' }) {
  const git = presenceGit(), root = path.dirname(git.commonDir());
  fs.mkdirSync(path.join(root, '.github'));
  fs.writeFileSync(path.join(root, '.github', 'atc-presence.json'), JSON.stringify(policy));
  for (const args of [['add', '.github/atc-presence.json'], ['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','Enable public presence']]) {
    assert.equal(spawnSync('git',args,{cwd:root,stdio:'pipe'}).status,0);
  }
  const posts = [], calls = [];
  const gh = { get: target => target === 'repos/example/project' ? { private: false } : { number: 42, state: 'open' },
    getOptional: target => target.endsWith('atc.json') ? {type:'file',encoding:'base64',size:2,content:'e30='} : {number:42,state:'open',assignees:[]},
    post: (target, fields) => {posts.push({target,...fields});return {id:123};} };
  return { git, now: Date.now, flags:{}, command:'start', gh, repository:()=> 'example/project', posts, calls,
    fetcher:async (url,options)=>{calls.push({url,...options});return Response.json({outcome:'published'});} };
}

test('repository-enabled starts publish automatically and anonymously, with named opt-in and a local override', async () => {
  for (const flags of [{}, {githubName:true}, {local:true}]) {
    const f=fixture(), local=reportPresence('start',{issue:42},f);
    const result=displayResult(await publishPresence(local,{...f,flags}));
    if(flags.local){assert.equal(result.publication,undefined);assert.equal(f.posts.length,0);continue;}
    assert.equal(result.publication,'public');assert.equal(f.calls[0].url,'https://example.org/api/atc/v1/presence');
    const body=JSON.parse(f.calls[0].body);assert.equal(body.display,flags.githubName?'github':'anonymous');
    assert.doesNotMatch(JSON.stringify(result),new RegExp(body.token));
  }
});

test('successful claims start a public session and preserve the claim comment and result', async () => {
  const f=fixture(), claim={issue:42,command:'claim',posted:true,comment:456,outcome:'claimed'};
  const result=displayResult(await claimPresence(claim,f));
  assert.equal(result.comment,456);assert.equal(result.outcome,'claimed');assert.ok(result.session);assert.equal(result.publication,'public');
  assert.equal(JSON.parse(f.calls[0].body).display,'anonymous');assert.equal(f.posts.length,1);
  for(const outcome of ['claimTaken','pending','dryRun','readOnly','claimUpdated']) {
    const before=f.calls.length;assert.equal((await claimPresence({...claim,outcome},f)).session,undefined);assert.equal(f.calls.length,before);
  }
});

test('policies cannot publish private repositories, other repositories, malformed endpoints or uncommitted changes', async () => {
  const f=fixture(); f.gh.get=()=>({private:true});
  const result=await publishPresence(reportPresence('start',{issue:42},f),f);
  assert.equal(result.publication,'unavailable');assert.equal(f.posts.length,0);assert.equal(f.calls.length,0);
  const other=fixture();other.repository=()=> 'example/other';
  assert.equal((await publishPresence(reportPresence('start',{issue:42},other),other)).publication,undefined);
  assert.equal(other.posts.length,0);
  for(const origin of ['http://example.org','https://example.org/path','https://user@example.org','https://example.org\n'])assert.equal(presencePolicy(fixture({version:1,repository:'example/project',origin}).git),null);
  const local=fixture();fs.writeFileSync(path.join(path.dirname(local.git.commonDir()),'.github/atc-presence.json'),'{}');
  assert.equal(presencePolicy(local.git).origin,'https://example.org');
});

test('the actual CLI claim path publishes once, returns its session, and later pulses use that session', async () => {
  const {runCli}=await import('../src/cli/actions.js'),{parseCliArgs}=await import('../src/cli/args.js');
  const {createGh}=await import('../src/cli/gh.js'),{setup}=await import('./helpers.js');
  const f=fixture({version:1,repository:'acme/widgets',origin:'https://example.org'}),fake=setup();
  fake.store.cliUser='alice';const issue=fake.addIssue(),base=createGh(fake.runGh);
  const gh={...base,get:target=>target==='repos/acme/widgets'?{private:false}:base.get(target)};
  const deps={...f,gh,env:{},now:()=>fake.clock.now,sleep:async()=>{fake.clock.now+=1000;}};
  const result=await runCli(parseCliArgs(['claim',String(issue.number)]),deps);
  assert.equal(result.outcome,'claimed');assert.equal(result.publication,'public');assert.ok(result.session);
  assert.equal(f.calls.length,1);assert.equal(fake.store.comments.length,2);
  assert.equal(fake.store.comments[0].body,'/atc claim');assert.match(fake.store.comments[1].body,/^\/atc presence [a-f0-9]{64}$/);
  const pulse=await runCli(parseCliArgs(['pulse',String(issue.number),String(result.session),'reviewing']),deps);
  assert.equal(pulse.publication,'public');assert.equal(JSON.parse(f.calls[1].body).state,'reviewing');
});

test('local-only markers stop sharing and can be removed after landing', async () => {
 const {markLocalOnly,isLocalOnly,clearLocalOnly}=await import('../src/cli/localPresenceOnly.js');
 const {shareResult}=await import('../src/cli/presenceShare.js');const f=fixture();
 const local=reportPresence('start',{issue:42},{...f,localOnly:true});assert.equal(isLocalOnly(f.git,local.session),true);
 assert.deepEqual(shareResult(local,{...f,repository:f.repository}),local);
 clearLocalOnly(f.git,local.session);assert.equal(isLocalOnly(f.git,local.session),false);
 const args=['claim','42','--local'];
 const {parseCliArgs}=await import('../src/cli/args.js');assert.equal(parseCliArgs(args).flags.local,true);
});
