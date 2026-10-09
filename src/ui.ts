/** Small DOM helpers; all user-controlled copy is assigned as text, never HTML. */
export const $=<T extends HTMLElement=HTMLElement>(id:string):T=>{const e=document.getElementById(id);if(!e)throw Error(`Missing interface element: ${id}`);return e as T;};
export const el=<K extends keyof HTMLElementTagNameMap>(tag:K,cls='',text=''):HTMLElementTagNameMap[K]=>{const e=document.createElement(tag);e.className=cls;e.textContent=text;return e;};
const paths:Record<string,string>={
 route:'M4 17a3 3 0 1 0 6 0 3 3 0 0 0-6 0Zm10-10a3 3 0 1 0 6 0 3 3 0 0 0-6 0ZM7 14V7a3 3 0 0 1 3-3h1m6 6v7a3 3 0 0 1-3 3h-1',
 plus:'M12 5v14M5 12h14',minus:'M5 12h14',undo:'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 6 6v3',redo:'m15 5 5 5-5 5m5-5h-9a6 6 0 0 0-6 6v3',
 reverse:'M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4',back:'M5 5h10a5 5 0 0 1 0 10H5m4-4-4 4 4 4',trash:'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5',
 loop:'m17 1 4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
 fit:'M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5',search:'M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
 upload:'M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5',download:'M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4',history:'M3 11a9 9 0 1 1 2 7M3 4v7h7m2-5v6l4 2',
 settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',
 close:'m6 6 12 12M18 6 6 18',check:'m5 12 4 4L19 6',save:'M5 3h12l4 4v14H3V3h2Zm2 0v6h10V3M7 21v-8h10v8',chevron:'m8 4 8 8-8 8',up:'m6 15 6-6 6 6',down:'m6 9 6 6 6-6',
 sun:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2',
 hand:'M7 12V6a2 2 0 0 1 4 0v6-8a2 2 0 0 1 4 0v8-6a2 2 0 0 1 4 0v8-3a2 2 0 0 1 4 0v6c0 5-3 7-7 7-3 0-5-2-7-5l-4-5a2 2 0 0 1 3-3l3 3',
 info:'M12 11v6m0-10v.1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',duplicate:'M9 9h12v12H9V9Zm-4 6H3V3h12v2',pin:'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Zm-5 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0'
};
export function icon(name:string):SVGSVGElement {const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('fill','none');s.setAttribute('stroke','currentColor');s.setAttribute('stroke-width','1.65');s.setAttribute('stroke-linecap','round');s.setAttribute('stroke-linejoin','round');s.setAttribute('aria-hidden','true');s.classList.add('icon');const p=document.createElementNS(s.namespaceURI,'path');p.setAttribute('d',paths[name]||paths.info);s.append(p);return s;}
export function button(label:string,action:()=>void,ico?:string,cls=''):HTMLButtonElement {const b=el('button',cls);b.type='button';b.title=label;b.setAttribute('aria-label',label);if(ico)b.append(icon(ico));else b.textContent=label;b.onclick=action;return b;}
let toastTimer:ReturnType<typeof setTimeout>;
export function toast(message:string):void {const e=$('toast');e.textContent=message;e.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.hidden=true,6500);}
export function installIcons():void {document.querySelectorAll<HTMLElement>('[data-icon]').forEach(e=>e.prepend(icon(e.dataset.icon!)));}
export function setText(id:string,text:string):void {$(id).textContent=text;}
export function setInput(id:string,value:string|number):void {const e=$<HTMLInputElement>(id);if(document.activeElement!==e)e.value=String(value);}
