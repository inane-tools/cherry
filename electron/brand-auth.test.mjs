import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Innertube } from 'youtubei.js';
test('brand requests carry both account slot and delegated page identity', async () => {
 let headers, body;
 const client=await Innertube.create({ generate_session_locally:true, retrieve_innertube_config:false, retrieve_player:false,
   cookie:'SAPISID=synthetic-signing-cookie; SID=synthetic-session', account_index:2, on_behalf_of_user:'brand-page-id',
   fetch:async (_request, options) => { headers=new Headers(options.headers); body=JSON.parse(options.body); return new Response('{}',{status:200,headers:{'content-type':'application/json'}}); }
 });
 await client.actions.execute('/browse',{browseId:'FEmusic_liked_playlists',client:'YTMUSIC'});
 assert.equal(headers.get('X-Goog-Authuser'),'2');
 assert.equal(headers.get('X-Goog-PageId'),'brand-page-id');
 assert.equal(body.context.user.onBehalfOfUser,'brand-page-id');
 assert.ok(headers.get('Authorization').startsWith('SAPISIDHASH '));
});

test('personal account discovery ignores a previously cached brand session', async () => {
 const entries = new Map();
 let reads = 0;
 const cache = { get: async key => { reads++; return entries.get(key); }, set: async (key, value) => entries.set(key, value) };
 const common = { generate_session_locally: true, retrieve_innertube_config: false, retrieve_player: false, cache };
 await Innertube.create({ ...common, account_index: 2, on_behalf_of_user: 'old-brand' });
 assert.ok(entries.has('innertube_session_data'));
 let body, headers;
 const personal = await Innertube.create({ ...common, enable_session_cache: false, account_index: 1,
  cookie: 'SAPISID=synthetic-signing-cookie; SID=synthetic-session',
  fetch: async (_request, options) => { body = JSON.parse(options.body); headers = new Headers(options.headers); return new Response('{}'); },
 });
 await personal.actions.execute('/account/accounts_list', { client: 'YTMUSIC' });
 assert.equal(reads, 1);
 assert.equal(headers.get('X-Goog-Authuser'), '1');
 assert.equal(headers.get('X-Goog-PageId'), null);
 assert.equal(body.context.user.onBehalfOfUser, undefined);
});
