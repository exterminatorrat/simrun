export interface Point { lat:number; lon:number; ele?:number; time?:number; hr?:number }
export type Sport = 'run' | 'ride';
export type RouteSource = 'draft' | 'routed' | 'imported';
export interface LoopPlan { start:number; mode:'laps'|'distance'; value:number }
export interface Settings {
  sport:Sport; start:string; utcOffset:number; pace:number; speed:number;
  mode:'constant'|'natural'; variation:number; sample:1|2|5;
  hrEnabled:boolean; hrAverage:number; hrVariation:number; seed:number;
}
export interface Activity {
  id:string; version:1; name:string; createdAt:number; updatedAt:number;
  waypoints:Point[]; path:Point[]; source:RouteSource; settings:Settings; loop?:LoopPlan;
}
export interface Sample extends Point { time:number; distance:number; speed:number }
export interface Simulation { points:Sample[]; duration:number; distance:number; interval:number }
export interface Preferences {units:'metric'|'imperial'; theme:'light'|'dark'; mapStyle:string; routingUrl:string; elevationUrl:string; geocodingUrl:string; geocodingEnabled:boolean }
export interface ElevationStats {gain:number|null;loss:number|null;min:number|null;max:number|null}
