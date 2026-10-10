export type ShortcutId='undo'|'redo'|'delete-waypoint'|'fit'|'escape'|'help';
export interface Shortcut {
 id:ShortcutId;
 keys:string;
 description:string;
 key:string[];
 command:boolean;
 shift:boolean|'either';
}
export interface ShortcutEvent {key:string;ctrlKey:boolean;metaKey:boolean;altKey:boolean;shiftKey:boolean}
export const shortcuts:Shortcut[]=[
 {id:'undo',keys:'Ctrl/⌘ + Z',description:'Undo the last route edit',key:['z'],command:true,shift:false},
 {id:'redo',keys:'Ctrl/⌘ + Shift + Z',description:'Redo the last route edit',key:['z'],command:true,shift:true},
 {id:'delete-waypoint',keys:'Delete / Backspace',description:'Delete the selected waypoint',key:['delete','backspace'],command:false,shift:false},
 {id:'fit',keys:'F',description:'Fit the route in the map',key:['f'],command:false,shift:false},
 {id:'escape',keys:'Escape',description:'Cancel freehand drawing and close the activity panel',key:['escape'],command:false,shift:false},
 {id:'help',keys:'?',description:'Open keyboard shortcut help',key:['?'],command:false,shift:'either'}
];
export function matchShortcut(event:ShortcutEvent):Shortcut|null {
 if(event.altKey)return null;
 const command=event.ctrlKey||event.metaKey;
 return shortcuts.find(shortcut=>shortcut.key.includes(event.key.toLowerCase())&&shortcut.command===command&&(shortcut.shift==='either'||shortcut.shift===event.shiftKey))??null;
}
