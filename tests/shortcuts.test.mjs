import test from 'node:test';
import assert from 'node:assert/strict';
import {matchShortcut,shortcuts} from '../dist/src/shortcuts.js';

const event=(key,values={})=>({key,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,...values});

test('the documented shortcut array is the handler source for every supported action',()=>{
 assert.deepEqual(shortcuts.map(shortcut=>shortcut.id),['undo','redo','delete-waypoint','fit','escape','help']);
 for(const shortcut of shortcuts)assert.ok(shortcut.keys&&shortcut.description);
});

test('undo and redo require the explicit command chord',()=>{
 assert.equal(matchShortcut(event('z',{ctrlKey:true}))?.id,'undo');
 assert.equal(matchShortcut(event('z',{metaKey:true,shiftKey:true}))?.id,'redo');
 assert.equal(matchShortcut(event('z')),null);
 assert.equal(matchShortcut(event('z',{ctrlKey:true,altKey:true})),null);
 assert.equal(matchShortcut(event('f',{ctrlKey:true})),null);
});

test('editing, fit, escape, and help shortcuts match only their listed keys',()=>{
 assert.equal(matchShortcut(event('Delete'))?.id,'delete-waypoint');
 assert.equal(matchShortcut(event('Backspace'))?.id,'delete-waypoint');
 assert.equal(matchShortcut(event('f'))?.id,'fit');
 assert.equal(matchShortcut(event('Escape'))?.id,'escape');
 assert.equal(matchShortcut(event('?',{shiftKey:true}))?.id,'help');
 assert.equal(matchShortcut(event('F',{shiftKey:true})),null);
});
