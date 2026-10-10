import {en,type Message} from './locales/en.js';

type Catalog=Partial<Record<keyof typeof en,Message>>;
type Parameters=Readonly<Record<string,string|number|Date>>;
type LocaleModule={default?:Record<string,Message>};
const preferenceKey='simrun.locale';
const english:Readonly<Record<string,Message>>=en;
let preference='auto';
let activeLocale='en';
let catalog:Readonly<Record<string,Message>>=english;

function readPreference():string {
 try {
  const value=localStorage.getItem(preferenceKey)??sessionStorage.getItem(preferenceKey);
  return value==='auto'||value==='en'||value==='en-XA'||value==='ar-XB'||isLocale(value)?value:'auto';
 } catch {
  try {
   const value=sessionStorage.getItem(preferenceKey);
   return value==='auto'||value==='en'||value==='en-XA'||value==='ar-XB'||isLocale(value)?value:'auto';
  } catch {
   return 'auto';
  }
 }
}

function isLocale(value:string|null):value is string {
 if(!value||value==='auto')return false;
 try{return Intl.getCanonicalLocales(value).length===1;}catch{return false;}
}

function requestedLocale():string {
 const requested=preference==='auto'?(navigator.languages?.[0]||navigator.language||'en'):preference;
 if(requested==='en-XA'||requested==='ar-XB')return requested;
 if(!isLocale(requested))return 'en';
 return Intl.getCanonicalLocales(requested)[0]||'en';
}

async function loadCatalog(locale:string):Promise<void> {
 activeLocale=locale;
 catalog=english;
 if(locale==='en-XA'||locale==='ar-XB')return;
 if(locale.toLowerCase()==='en'){
  activeLocale='en';
  return;
 }
 const candidates=[locale,...locale.split('-').slice(0,1)];
 for(const candidate of candidates){
  if(candidate.toLowerCase()==='en')continue;
  try{
   const loaded=await import(`./locales/${candidate}.js`) as LocaleModule;
   if(loaded.default){catalog=loaded.default as Catalog;activeLocale=candidate;return;}
  }catch{
   activeLocale='en';
  }
 }
 activeLocale='en';
}

function intlLocale():string {
 return activeLocale==='en-XA'||activeLocale==='ar-XB'?'en':activeLocale;
}

function interpolate(message:string,params:Parameters):string {
 return message.replace(/\{([\w]+)\}/g,(match,name)=>{
  const value=params[name];
  if(value===undefined)return match;
  if(value instanceof Date)return formatDate(value);
  return typeof value==='number'?formatNumber(value):String(value);
 });
}

function pseudo(text:string,locale:string):string {
 if(locale==='en-XA'){
  let letters=0;
  const accented=text.replace(/\{[\w]+\}|[A-Za-z]/g,value=>{
   if(value.startsWith('{'))return value;
   const letter=value.toLowerCase();
   const mapped:Record<string,string>={a:'á',b:'ƀ',c:'ç',d:'ď',e:'ë',f:'ƒ',g:'ğ',h:'ħ',i:'ï',j:'ĵ',k:'ķ',l:'ľ',m:'ɱ',n:'ñ',o:'ö',p:'þ',q:'ɋ',r:'ř',s:'š',t:'ŧ',u:'ü',v:'ṽ',w:'ŵ',x:'ẋ',y:'ý',z:'ž'};
   const result=mapped[letter]||value;
   letters++;
   return (value===letter?result:result.toUpperCase())+(letters%3===0?'·':'');
  });
  return `⟦${accented}⟧`;
 }
 const parts=text.split(/(\{[\w]+\})/g);
 return `‏${parts.reverse().map(part=>part.startsWith('{')?part:Array.from(part).reverse().join('')).join('')}‏`;
}

function catalogValue(value:Message,count:number|undefined):string {
 if(typeof value==='string')return value;
 const rule=new Intl.PluralRules(intlLocale()).select(count??0) as keyof typeof value;
 return value[rule]||value.other;
}

type MessagePattern={key:string;pattern:RegExp;names:string[]};
let patterns:MessagePattern[]|null=null;
function messagePatterns():MessagePattern[] {
 if(patterns)return patterns;
 patterns=Object.keys(english).flatMap(key=>{
  const names=[...key.matchAll(/\{([\w]+)\}/g)].map(match=>match[1]);
  if(!names.length)return [];
  const parts=key.split(/\{[\w]+\}/g);
  const source=parts.map((part,index)=>`${part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}${index<names.length?'(.+?)':''}`).join('');
  return [{key,pattern:new RegExp(`^${source}$`),names}];
 });
 return patterns;
}

function lookup(key:string,params:Parameters):{value:Message;params:Parameters}|null {
 const value=catalog[key]??english[key];
 if(value)return {value,params};
 for(const entry of messagePatterns()){
  const match=entry.pattern.exec(key);
  if(!match)continue;
  const values:Record<string,string|number|Date>={...params};
  entry.names.forEach((name,index)=>{const value=match[index+1];values[name]=name==='count'&&/^\d+(?:\.\d+)?$/.test(value)?Number(value):value;});
  const template=catalog[entry.key]??english[entry.key];
  if(template)return {value:template,params:values};
 }
 return null;
}

export function t(key:string,params:Parameters={}):string {
 const result=lookup(key,params);
 if(!result)return key;
 const count=result.params.count;
 const message=catalogValue(result.value,typeof count==='number'?count:undefined);
 return interpolate(activeLocale==='en-XA'||activeLocale==='ar-XB'?pseudo(message,activeLocale):message,result.params);
}

export function localePreference():string {
 return preference;
}

export function locale():string {
 return activeLocale;
}

export function formatNumber(value:number,options:Intl.NumberFormatOptions={}):string {
 return new Intl.NumberFormat(intlLocale(),options).format(value);
}

export function formatDate(value:Date|number|string,options:Intl.DateTimeFormatOptions={dateStyle:'medium'}):string {
 const date=value instanceof Date?value:new Date(value);
 return new Intl.DateTimeFormat(intlLocale(),options).format(date);
}

export function formatTime(value:Date|number|string):string {
 return formatDate(value,{hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
}

export function formatClock(seconds:number):string {
 const total=Math.max(0,Math.round(seconds));
 return `${formatNumber(Math.floor(total/60),{minimumIntegerDigits:2})}:${formatNumber(total%60,{minimumIntegerDigits:2})}`;
}

export function formatRelative(value:number,unit:Intl.RelativeTimeFormatUnit):string {
 return new Intl.RelativeTimeFormat(intlLocale(),{numeric:'auto'}).format(value,unit);
}

export function formatDuration(seconds:number):string {
 let remaining=Math.max(0,Math.floor(seconds));
 const hours=Math.floor(remaining/3600);
 remaining%=3600;
 const minutes=Math.floor(remaining/60);
 const secondsLeft=remaining%60;
 const parts:string[]=[];
 if(hours)parts.push(t('duration.hour',{count:hours}));
 if(minutes)parts.push(t('duration.minute',{count:minutes}));
 if(secondsLeft||!parts.length)parts.push(t('duration.second',{count:secondsLeft}));
 return new Intl.ListFormat(intlLocale(),{style:'long',type:'conjunction'}).format(parts);
}

export function applyLocale(root:ParentNode=document):void {
 document.documentElement.lang=activeLocale;
 document.documentElement.dir=activeLocale==='ar-XB'||/^(ar|fa|he|ur)(-|$)/i.test(activeLocale)?'rtl':'ltr';
 root.querySelectorAll<HTMLElement>('[data-i18n]').forEach(element=>{if(!element.closest('[data-i18n-exempt]'))element.textContent=t(element.dataset.i18n||'');});
 root.querySelectorAll<HTMLElement>('[data-i18n-attr]').forEach(element=>{
  if(element.closest('[data-i18n-exempt]'))return;
  const attributes=JSON.parse(element.dataset.i18nAttr||'{}') as Record<string,string>;
  Object.entries(attributes).forEach(([name,key])=>element.setAttribute(name,t(key)));
 });
}

export async function initializeLocale():Promise<void> {
 preference=readPreference();
 await loadCatalog(requestedLocale());
 applyLocale();
}

export async function setLocale(value:string):Promise<void> {
 const next=value==='auto'||value==='en'||value==='en-XA'||value==='ar-XB'||isLocale(value)?value:'auto';
 preference=next;
 try{localStorage.setItem(preferenceKey,next);}catch{try{sessionStorage.setItem(preferenceKey,next);}catch(error){if(!(error instanceof DOMException))throw error;}}
 await loadCatalog(requestedLocale());
 applyLocale();
}
