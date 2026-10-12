import type {RouteProfile,Sport} from './types.js';

export function usesPace(sport:Sport):boolean {
 return sport==='run'||sport==='walk'||sport==='hike'||sport==='trail-run';
}

export function profileForSport(sport:Sport):RouteProfile {
 if(sport==='hike'||sport==='trail-run')return 'hike';
 if(sport==='mtb')return 'mtb';
 return sport==='ride'?'road':'walk';
}

export function gpxSportType(sport:Sport):string {
 return ({run:'running',ride:'cycling',walk:'walking',hike:'hiking','trail-run':'trail running',mtb:'mountain biking'})[sport];
}

export function tcxSportType(sport:Sport):string {
 return sport==='run'||sport==='trail-run'?'Running':sport==='ride'||sport==='mtb'?'Biking':'Other';
}

export function sportLabel(sport:Sport):string {
 return ({run:'Run',ride:'Ride',walk:'Walk',hike:'Hike','trail-run':'Trail run',mtb:'Mountain bike'})[sport];
}

export function sportFromText(value:string):Sport {
 if(/mountain[ -]?bik|\bmtb\b/i.test(value))return 'mtb';
 if(/trail[ -]?run/i.test(value))return 'trail-run';
 if(/hik/i.test(value))return 'hike';
 if(/walk/i.test(value))return 'walk';
 if(/cycl|bik|ride/i.test(value))return 'ride';
 return 'run';
}
