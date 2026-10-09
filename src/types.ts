export interface Point { lat:number; lon:number; ele?:number; time?:number; hr?:number }
export type Sport = 'run' | 'ride';
export type RouteProfile = 'walk' | 'hike' | 'road' | 'mtb';
export type RouteSource = 'draft' | 'routed' | 'imported';
export interface LoopPlan { start:number; mode:'laps'|'distance'; value:number }
export interface GpsSim { noise:number; dropout:number }
export interface Splits { auto:number; markers:number[] }
export interface Settings {
  sport:Sport; profile?:RouteProfile; start:string; utcOffset:number; pace:number; speed:number;
  mode:'constant'|'natural'; variation:number; sample:1|2|5;
  hrEnabled:boolean; hrAverage:number; hrVariation:number; seed:number;
  gps?:GpsSim;
}
export interface Activity {
  id:string; version:1; name:string; createdAt:number; updatedAt:number;
  waypoints:Point[]; path:Point[]; source:RouteSource; settings:Settings; loop?:LoopPlan; splits?:Splits;
}
export interface Sample extends Point { time:number; distance:number; speed:number }
export interface Simulation { points:Sample[]; duration:number; distance:number; interval:number }
export interface Split { start:number; end:number; distance:number; duration:number; speed:number; gain:number|null }
export interface Preferences {units:'metric'|'imperial'; theme:'light'|'dark'; mapStyle:string; mapStyleDark:string; routingUrl:string; elevationUrl:string; geocodingUrl:string; geocodingEnabled:boolean }
export interface ElevationStats {gain:number|null;loss:number|null;min:number|null;max:number|null}
