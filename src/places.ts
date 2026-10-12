import type {Place,SavedPlace} from './types.js';
import {validPoint} from './geometry.js';

export const MAX_SAVED_PLACES=100;
export const SUGGESTION_DEBOUNCE_MS=600;
export const SUGGESTION_MIN_LENGTH=3;

export function parseCoordinateQuery(query:string):Place|null {
 const match=query.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
 if(!match)return null;
 const place={lat:+match[1],lon:+match[2],name:'Coordinates'};
 if(!validPoint(place))throw Error('Coordinates are outside latitude/longitude bounds.');
 return place;
}

function record(value:unknown):Record<string,unknown>|null {
 return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
}

function text(value:unknown):string|undefined {return typeof value==='string'&&value.trim()?value.trim():undefined;}

export function parsePhotonResponse(value:unknown):Place[] {
 const collection=record(value);
 if(!Array.isArray(collection?.features))throw Error('Photon returned invalid place results.');
 const places:Place[]=[];
 for(const item of collection.features){
  const feature=record(item),geometry=record(feature?.geometry),properties=record(feature?.properties),coordinates=geometry?.coordinates;
  if(geometry?.type!=='Point'||!Array.isArray(coordinates)||coordinates.length<2||!properties)continue;
  const lon=coordinates[0],lat=coordinates[1];
  if(typeof lon!=='number'||typeof lat!=='number')continue;
  const primary=text(properties.name)??text(properties.locality)??text(properties.city)??text(properties.town)??text(properties.village);
  const locality=text(properties.city)??text(properties.town)??text(properties.village)??text(properties.county);
  const context=[locality,text(properties.state),text(properties.country)].filter((value):value is string=>!!value&&value!==primary);
  const name=[primary??context.shift()??'Place',...context].filter((value,index,all)=>all.indexOf(value)===index).join(', ');
  const place={name,lat,lon};
  if(validPoint(place))places.push(place);
  if(places.length===5)break;
 }
 return places;
}

export function searchSavedPlaces(places:SavedPlace[],query:string):Place[] {
 try{const coordinate=parseCoordinateQuery(query);if(coordinate)return [coordinate];}catch{return [];}
 const tokens=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
 if(!tokens.length)return [];
 return places.filter(place=>tokens.every(token=>place.name.toLocaleLowerCase().includes(token))).slice(0,5).map(({name,lat,lon})=>({name,lat,lon}));
}

export function validateSavedPlaces(value:unknown):SavedPlace[] {
 if(!Array.isArray(value))return [];
 const places:SavedPlace[]=[],ids=new Set<string>();
 for(const item of value){
  const source=record(item);
  if(!source||typeof source.id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(source.id)||typeof source.name!=='string'||typeof source.lat!=='number'||typeof source.lon!=='number')continue;
  const id=source.id,name=source.name.trim(),place={id,name,lat:source.lat,lon:source.lon};
  if(ids.has(id)||!name||name.length>80||!validPoint(place))continue;
  ids.add(id);places.push(place);
  if(places.length===MAX_SAVED_PLACES)break;
 }
 return places;
}

export class LruCache<K,V> {
 private values=new Map<K,V>();
 constructor(readonly limit:number){if(!Number.isInteger(limit)||limit<1)throw Error('Cache limit must be a positive integer.');}
 get size():number{return this.values.size;}
 get(key:K):V|undefined {
  if(!this.values.has(key))return undefined;
  const value=this.values.get(key)!;this.values.delete(key);this.values.set(key,value);return value;
 }
 set(key:K,value:V):void {
  this.values.delete(key);this.values.set(key,value);
  while(this.values.size>this.limit)this.values.delete(this.values.keys().next().value!);
 }
 clear():void{this.values.clear();}
}

export class PlaceSuggestionSearch<T> {
 readonly cache=new LruCache<string,T[]>(24);
 private timer:ReturnType<typeof setTimeout>|null=null;
 private active:AbortController|null=null;
 private generation=0;
 constructor(private request:(query:string,signal:AbortSignal)=>Promise<T[]>,private onResults:(query:string,results:T[])=>void,private onError:(error:unknown)=>void=()=>{},private delay=SUGGESTION_DEBOUNCE_MS,private minimumLength=SUGGESTION_MIN_LENGTH){
  if(delay<400||!Number.isFinite(delay))throw Error('Search suggestions must be debounced by at least 400 ms.');
 }
 search(input:string):void {
  const query=input.trim(),key=query.toLocaleLowerCase(),generation=++this.generation;
  if(this.timer)clearTimeout(this.timer);this.timer=null;this.active?.abort();this.active=null;
  if(Array.from(query).length<this.minimumLength){this.onResults(query,[]);return;}
  const cached=this.cache.get(key);
  if(cached){this.onResults(query,cached);return;}
  this.timer=setTimeout(()=>{
   this.timer=null;const controller=new AbortController();this.active=controller;
   void Promise.resolve().then(()=>this.request(query,controller.signal)).then(results=>{
    if(generation!==this.generation||controller.signal.aborted)return;
    this.cache.set(key,results);this.onResults(query,results);
   }).catch(error=>{if(generation===this.generation&&!controller.signal.aborted)this.onError(error);});
  },this.delay);
 }
 cancel():void {
  this.generation++;if(this.timer)clearTimeout(this.timer);this.timer=null;this.active?.abort();this.active=null;
 }
}
