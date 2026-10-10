export interface ZipEntry {
 name:string;
 data:string|Uint8Array;
 modifiedAt?:Date;
}
export const ZIP_LIMITS={files:2000,fileBytes:50000000,totalBytes:500000000} as const;
const encoder=new TextEncoder();
const crcTable=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
export function crc32(bytes:Uint8Array):number {
 let crc=0xffffffff;
 for(const byte of bytes)crc=crcTable[(crc^byte)&0xff]^(crc>>>8);
 return (crc^0xffffffff)>>>0;
}
function dosTimestamp(date:Date):{time:number;date:number} {
 if(!Number.isFinite(date.getTime()))throw Error('ZIP timestamp is invalid.');
 const year=Math.min(2107,Math.max(1980,date.getFullYear()));
 return {time:(date.getHours()<<11)|(date.getMinutes()<<5)|(date.getSeconds()>>1),date:((year-1980)<<9)|((date.getMonth()+1)<<5)|date.getDate()};
}
function validateName(name:string):Uint8Array {
 if(!name||name.startsWith('/')||name.includes('\\')||name.includes('\0')||name.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('ZIP file name is invalid.');
 const bytes=encoder.encode(name);
 if(bytes.length>65535)throw Error('ZIP file name is too long.');
 return bytes;
}
export function createZip(entries:ZipEntry[]):Uint8Array {
 if(entries.length>ZIP_LIMITS.files)throw Error(`ZIP can contain at most ${ZIP_LIMITS.files} files.`);
 const names=new Set<string>();
 const files=entries.map(entry=>{
  const name=validateName(entry.name);
  if(names.has(entry.name))throw Error('ZIP file names must be unique.');
  names.add(entry.name);
  const data=typeof entry.data==='string'?encoder.encode(entry.data):entry.data;
  if(!(data instanceof Uint8Array))throw Error('ZIP file data must be text or bytes.');
  if(data.length>ZIP_LIMITS.fileBytes)throw Error(`ZIP files must be smaller than ${ZIP_LIMITS.fileBytes} bytes.`);
  const timestamp=dosTimestamp(entry.modifiedAt??new Date());
  return {name,data,crc:0,timestamp};
 });
 const localSize=files.reduce((sum,file)=>sum+30+file.name.length+file.data.length,0);
 const directorySize=files.reduce((sum,file)=>sum+46+file.name.length,0);
 const total=localSize+directorySize+22;
 if(total>ZIP_LIMITS.totalBytes||total>0xffffffff||localSize>0xffffffff||directorySize>0xffffffff)throw Error(`ZIP must be smaller than ${ZIP_LIMITS.totalBytes} bytes.`);
 for(const file of files)file.crc=crc32(file.data);
 const output=new Uint8Array(total),view=new DataView(output.buffer),localOffsets:number[]=[];
 let offset=0;
 const write16=(at:number,value:number)=>view.setUint16(at,value,true);
 const write32=(at:number,value:number)=>view.setUint32(at,value>>>0,true);
 for(const file of files){
  localOffsets.push(offset);
  write32(offset,0x04034b50);write16(offset+4,20);write16(offset+6,0x0800);write16(offset+8,0);
  write16(offset+10,file.timestamp.time);write16(offset+12,file.timestamp.date);write32(offset+14,file.crc);
  write32(offset+18,file.data.length);write32(offset+22,file.data.length);write16(offset+26,file.name.length);write16(offset+28,0);
  output.set(file.name,offset+30);offset+=30+file.name.length;output.set(file.data,offset);offset+=file.data.length;
 }
 const centralOffset=offset;
 for(let index=0;index<files.length;index++){
  const file=files[index];
  write32(offset,0x02014b50);write16(offset+4,0x0314);write16(offset+6,20);write16(offset+8,0x0800);write16(offset+10,0);
  write16(offset+12,file.timestamp.time);write16(offset+14,file.timestamp.date);write32(offset+16,file.crc);
  write32(offset+20,file.data.length);write32(offset+24,file.data.length);write16(offset+28,file.name.length);write16(offset+30,0);
  write16(offset+32,0);write16(offset+34,0);write16(offset+36,0);write32(offset+38,0);write32(offset+42,localOffsets[index]);
  output.set(file.name,offset+46);offset+=46+file.name.length;
 }
 write32(offset,0x06054b50);write16(offset+4,0);write16(offset+6,0);write16(offset+8,files.length);write16(offset+10,files.length);
 write32(offset+12,directorySize);write32(offset+16,centralOffset);write16(offset+20,0);
 return output;
}
