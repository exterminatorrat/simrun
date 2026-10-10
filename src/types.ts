export interface Point { lat:number; lon:number; ele?:number; time?:number; hr?:number }
export type Sport = 'run' | 'ride';
export type RouteProfile = 'walk' | 'hike' | 'road' | 'mtb';
export type RouteSource = 'draft' | 'routed' | 'imported';
export interface LoopPlan { start:number; mode:'laps'|'distance'; value:number }
export interface GpsSim { noise:number; dropout:number }
export interface Splits { auto:number; markers:number[] }
export type WeatherPreset = 'ideal' | 'cool' | 'mild' | 'warm' | 'hot' | 'humid' | 'windy';
export interface WeatherSim { preset:WeatherPreset; tempC:number; humidity:number; headwindKph:number }
export interface PowerSim { enabled:boolean; weightKg:number }
export interface CadenceSim { enabled:boolean }
export interface FatigueSim { percent:number }
export interface WorkoutStep { kind:'work'|'rest'; distance:number; pace?:number; speed?:number; hr?:number }
export interface Workout { steps:WorkoutStep[] }
export interface RestStop { distance:number; seconds:number }
export interface Pauses { rests:RestStop[] }
export interface Settings {
  sport:Sport; profile?:RouteProfile; start:string; utcOffset:number; pace:number; speed:number;
  mode:'constant'|'natural'; variation:number; sample:1|2|5;
  hrEnabled:boolean; hrAverage:number; hrVariation:number; seed:number;
  gps?:GpsSim; power?:PowerSim; cadence?:CadenceSim; fatigue?:FatigueSim; weather?:WeatherSim;
}
export interface Activity {
  id:string; version:1; name:string; createdAt:number; updatedAt:number;
  waypoints:Point[]; path:Point[]; source:RouteSource; settings:Settings; loop?:LoopPlan; splits?:Splits;
  workout?:Workout; pauses?:Pauses; tags?:string[];
}
export interface Sample extends Point { time:number; distance:number; speed:number; power?:number; cad?:number }
export interface Simulation { points:Sample[]; duration:number; distance:number; interval:number; calories?:number }
export interface Split { start:number; end:number; distance:number; duration:number; speed:number; gain:number|null; stopped?:boolean }
export interface Preferences {units:'metric'|'imperial'; theme:'light'|'dark'; mapStyle:string; mapStyleDark:string; routingUrl:string; elevationUrl:string; geocodingUrl:string; geocodingEnabled:boolean; hrMax:number; offlineRouting:boolean; corridorZoom:number; avoidHighways:boolean; avoidHills:boolean; alternates:boolean }
export interface ElevationStats {gain:number|null;loss:number|null;min:number|null;max:number|null}
