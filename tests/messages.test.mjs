import test from 'node:test';
import assert from 'node:assert/strict';
import {failureMessage} from '../dist/src/messages.js';

test('network failures use one actionable message',()=>{
 const expected='Network unavailable — check your connection and retry.';
 assert.equal(failureMessage(new TypeError('Failed to fetch'),'Try again.'),expected);
 assert.equal(failureMessage('NetworkError when attempting to fetch resource.','Try again.'),expected);
 assert.equal(failureMessage(new Error('fetch failed'),'Try again.'),expected);
});

test('provider and storage failures include a next step',()=>{
 assert.equal(failureMessage(new Error('HTTP 429: Too Many Requests'),'Try again.'),'Provider is busy — wait a moment and retry.');
 assert.equal(failureMessage(new Error('HTTP 503: Service Unavailable'),'Try again.'),'The selected provider is unavailable — retry later.');
 assert.equal(failureMessage(new DOMException('The quota has been exceeded.','QuotaExceededError'),'Try again.'),'Local storage is full — export a backup or remove activities from History.');
 assert.equal(failureMessage(new Error('Local storage is unavailable.'),'Try again.'),'Browser storage is unavailable — allow site storage and reload.');
});

test('useful app errors survive while raw exceptions use the contextual fallback',()=>{
 assert.equal(failureMessage(new Error('Routes must be within 100 km to merge.'),'Try again.'),'Routes must be within 100 km to merge.');
 assert.equal(failureMessage(new TypeError('Cannot read properties of undefined.'),'Choose a valid route and retry.'),'Choose a valid route and retry.');
 assert.equal(failureMessage(new TypeError('Provider failure details.'),'Choose a valid route and retry.'),'Choose a valid route and retry.');
 assert.equal(failureMessage({message:'Unexpected token at position 1'},'Choose a valid route and retry.'),'Choose a valid route and retry.');
 assert.equal(failureMessage(null,'Choose a valid route and retry.'),'Choose a valid route and retry.');
});
