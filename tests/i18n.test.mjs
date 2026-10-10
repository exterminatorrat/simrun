import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {createRequire} from 'node:module';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const root=join(fileURLToPath(new URL('.',import.meta.url)),'..');
const require=createRequire(import.meta.url);
const ts=require('typescript');
const {en}=await import('../dist/src/locales/en.js');
const unescape=value=>value.replace(/&quot;/g,'"').replace(/&#x27;|&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const used=new Set();
const markup=(await readFile(join(root,'public/index.html'),'utf8')).replace(/<a[^>]*data-i18n-exempt[^>]*>[\s\S]*?<\/a>/g,'');
for(const match of markup.matchAll(/data-i18n="([^"]*)"/g))used.add(unescape(match[1]));
for(const match of markup.matchAll(/data-i18n-attr="([^"]*)"/g)){
 const attrs=JSON.parse(unescape(match[1]));
 Object.values(attrs).forEach(key=>used.add(key));
}
function messageKey(node){
 if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))return node.text;
 if(ts.isTemplateExpression(node)){
  let value=node.head.text;
  node.templateSpans.forEach((span,index)=>{
   const expression=span.expression;
   const name=ts.isIdentifier(expression)?expression.text:ts.isPropertyAccessExpression(expression)?expression.name.text:`value${index}`;
   value+=`{${name}}${span.literal.text}`;
  });
  return value;
 }
 return null;
}
function callName(node){
 if(ts.isIdentifier(node))return node.text;
 if(ts.isPropertyAccessExpression(node))return node.name.text;
 return '';
}
function collectMessages(node){
 const value=messageKey(node);
 if(value!==null){if(value.trim())used.add(value);return;}
 if(ts.isConditionalExpression(node)){collectMessages(node.whenTrue);collectMessages(node.whenFalse);return;}
 if(ts.isBinaryExpression(node)&&(node.operatorToken.kind===ts.SyntaxKind.BarBarToken||node.operatorToken.kind===ts.SyntaxKind.QuestionQuestionToken)){collectMessages(node.left);collectMessages(node.right);return;}
 if(ts.isCallExpression(node)){const name=callName(node.expression);if(name==='t'){if(node.arguments[0])collectMessages(node.arguments[0]);return;}if(name==='failureMessage'){if(node.arguments[1])collectMessages(node.arguments[1]);return;}}
}
async function collect(directory){
 for(const entry of await readdir(directory,{withFileTypes:true})){
  const path=join(directory,entry.name);
  if(entry.isDirectory()){await collect(path);continue;}
  if(!entry.name.endsWith('.ts')||relative(root,path)==='src/locales/en.ts')continue;
  const source=ts.createSourceFile(path,await readFile(path,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const visit=node=>{
   if(ts.isCallExpression(node)){
    const name=callName(node.expression);
    const indices=name==='t'||name==='toast'||name==='button'||name==='onMessage'||name==='Error'?[0]:name==='el'?[2]:name==='setText'||name==='failureMessage'?[1]:name==='stat'?[1,2]:[];
    for(const index of indices){const arg=node.arguments[index];if(!arg)continue;if(name==='el'&&node.arguments[3]?.kind===ts.SyntaxKind.FalseKeyword)continue;if(name==='button'&&node.arguments[4]?.kind===ts.SyntaxKind.FalseKeyword)continue;collectMessages(arg);}
   }
   if(ts.isPropertyAssignment(node)&&((path.endsWith('/shortcuts.ts')&&['keys','description'].includes(node.name.getText(source)))||(path.endsWith('/model.ts')&&node.name.getText(source)==='label'))){collectMessages(node.initializer);}
   ts.forEachChild(node,visit);
  };
  visit(source);
 }
}
await collect(join(root,'src'));

test('English catalog has every referenced key and no unused entries',()=>{
 const expected=new Set(Object.keys(en));
 assert.deepEqual([...used].filter(key=>!expected.has(key)).sort(),[],'missing English keys');
 assert.deepEqual([...expected].filter(key=>!used.has(key)).sort(),[],'unused English keys');
});

test('pseudo-locales generate accented expansion and RTL direction',async()=>{
 const storage=new Map();
 const document={documentElement:{lang:'',dir:''},querySelectorAll:()=>[]};
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{language:'en',languages:['en']}});
 Object.defineProperty(globalThis,'document',{configurable:true,value:document});
 const {setLocale,t,formatDuration}=await import('../dist/src/i18n.js');
 await setLocale('en-XA');
 assert.equal(document.documentElement.lang,'en-XA');
 assert.equal(document.documentElement.dir,'ltr');
 assert.match(t('Run'),/^⟦.*⟧$/);
 assert.match(t('lap',{count:2}),/^⟦2 .*⟧$/);
 assert.equal(t('untranslated-key'),'untranslated-key');
 assert.match(formatDuration(3661),/⟦/);
 await setLocale('ar-XB');
 assert.equal(document.documentElement.lang,'ar-XB');
 assert.equal(document.documentElement.dir,'rtl');
 assert.match(t('Run'),/^‏.*‏$/);
 assert.ok(!t('lap',{count:2}).includes('{count}'));
 await setLocale('en');
 assert.equal(document.documentElement.dir,'ltr');
});

test('service-worker precache includes the i18n runtime and locale source',async()=>{
 const manifest=JSON.parse(await readFile(join(root,'dist/sw-manifest.json'),'utf8'));
 assert.ok(manifest.files.includes('src/i18n.js'));
 assert.ok(manifest.files.includes('src/locales/en.js'));
});
