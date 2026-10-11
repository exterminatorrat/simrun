export type Ecc='L'|'M'|'Q'|'H';

const TOTAL_CW=[26,44,70,100,134,172,196,242,292,346,404,466,532,581,655,733,815,901,991,1085,1156,1258,1364,1474,1588,1706,1828,1921,2051,2185,2323,2465,2611,2761,2876,3034,3196,3362,3532,3706];
const RS_BLOCKS:Record<Ecc,[number,number,number][][]>={
 L:[[[1,26,19]],[[1,44,34]],[[1,70,55]],[[1,100,80]],[[1,134,108]],[[2,86,68]],[[2,98,78]],[[2,121,97]],[[2,146,116]],[[2,86,68],[2,87,69]],[[4,101,81]],[[2,116,92],[2,117,93]],[[4,133,107]],[[3,145,115],[1,146,116]],[[5,109,87],[1,110,88]],[[5,122,98],[1,123,99]],[[1,135,107],[5,136,108]],[[5,150,120],[1,151,121]],[[3,141,113],[4,142,114]],[[3,135,107],[5,136,108]],[[4,144,116],[4,145,117]],[[2,139,111],[7,140,112]],[[4,151,121],[5,152,122]],[[6,147,117],[4,148,118]],[[8,132,106],[4,133,107]],[[10,142,114],[2,143,115]],[[8,152,122],[4,153,123]],[[3,147,117],[10,148,118]],[[7,146,116],[7,147,117]],[[5,145,115],[10,146,116]],[[13,145,115],[3,146,116]],[[17,145,115]],[[17,145,115],[1,146,116]],[[13,145,115],[6,146,116]],[[12,151,121],[7,152,122]],[[6,151,121],[14,152,122]],[[17,152,122],[4,153,123]],[[4,152,122],[18,153,123]],[[20,147,117],[4,148,118]],[[19,148,118],[6,149,119]]],
 M:[[[1,26,16]],[[1,44,28]],[[1,70,44]],[[2,50,32]],[[2,67,43]],[[4,43,27]],[[4,49,31]],[[2,60,38],[2,61,39]],[[3,58,36],[2,59,37]],[[4,69,43],[1,70,44]],[[1,80,50],[4,81,51]],[[6,58,36],[2,59,37]],[[8,59,37],[1,60,38]],[[4,64,40],[5,65,41]],[[5,65,41],[5,66,42]],[[7,73,45],[3,74,46]],[[10,74,46],[1,75,47]],[[9,69,43],[4,70,44]],[[3,70,44],[11,71,45]],[[3,67,41],[13,68,42]],[[17,68,42]],[[17,74,46]],[[4,75,47],[14,76,48]],[[6,73,45],[14,74,46]],[[8,75,47],[13,76,48]],[[19,74,46],[4,75,47]],[[22,73,45],[3,74,46]],[[3,73,45],[23,74,46]],[[21,73,45],[7,74,46]],[[19,75,47],[10,76,48]],[[2,74,46],[29,75,47]],[[10,74,46],[23,75,47]],[[14,74,46],[21,75,47]],[[14,74,46],[23,75,47]],[[12,75,47],[26,76,48]],[[6,75,47],[34,76,48]],[[29,74,46],[14,75,47]],[[13,74,46],[32,75,47]],[[40,75,47],[7,76,48]],[[18,75,47],[31,76,48]]],
 Q:[[[1,26,13]],[[1,44,22]],[[2,35,17]],[[2,50,24]],[[2,33,15],[2,34,16]],[[4,43,19]],[[2,32,14],[4,33,15]],[[4,40,18],[2,41,19]],[[4,36,16],[4,37,17]],[[6,43,19],[2,44,20]],[[4,50,22],[4,51,23]],[[4,46,20],[6,47,21]],[[8,44,20],[4,45,21]],[[11,36,16],[5,37,17]],[[5,54,24],[7,55,25]],[[15,43,19],[2,44,20]],[[1,50,22],[15,51,23]],[[17,50,22],[1,51,23]],[[17,47,21],[4,48,22]],[[15,54,24],[5,55,25]],[[17,50,22],[6,51,23]],[[7,54,24],[16,55,25]],[[11,54,24],[14,55,25]],[[11,54,24],[16,55,25]],[[7,54,24],[22,55,25]],[[28,50,22],[6,51,23]],[[8,53,23],[26,54,24]],[[4,54,24],[31,55,25]],[[1,53,23],[37,54,24]],[[15,54,24],[25,55,25]],[[42,54,24],[1,55,25]],[[10,54,24],[35,55,25]],[[29,54,24],[19,55,25]],[[44,54,24],[7,55,25]],[[39,54,24],[14,55,25]],[[46,54,24],[10,55,25]],[[49,54,24],[10,55,25]],[[48,54,24],[14,55,25]],[[43,54,24],[22,55,25]],[[34,54,24],[34,55,25]]],
 H:[[[1,26,9]],[[1,44,16]],[[2,35,13]],[[4,25,9]],[[2,33,11],[2,34,12]],[[4,43,15]],[[4,39,13],[1,40,14]],[[4,40,14],[2,41,15]],[[4,36,12],[4,37,13]],[[6,43,15],[2,44,16]],[[3,36,12],[8,37,13]],[[7,42,14],[4,43,15]],[[12,33,11],[4,34,12]],[[11,36,12],[5,37,13]],[[11,36,12],[7,37,13]],[[3,45,15],[13,46,16]],[[2,42,14],[17,43,15]],[[2,42,14],[19,43,15]],[[9,39,13],[16,40,14]],[[15,43,15],[10,44,16]],[[19,46,16],[6,47,17]],[[34,37,13]],[[16,45,15],[14,46,16]],[[30,46,16],[2,47,17]],[[22,45,15],[13,46,16]],[[33,46,16],[4,47,17]],[[12,45,15],[28,46,16]],[[11,45,15],[31,46,16]],[[19,45,15],[26,46,16]],[[23,45,15],[25,46,16]],[[23,45,15],[28,46,16]],[[19,45,15],[35,46,16]],[[11,45,15],[46,46,16]],[[59,46,16],[1,47,17]],[[22,45,15],[41,46,16]],[[2,45,15],[64,46,16]],[[24,45,15],[46,46,16]],[[42,45,15],[32,46,16]],[[10,45,15],[67,46,16]],[[20,45,15],[61,46,16]]]
};
const ALIGN_POS:number[][]=[[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],[6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],[6,34,62,90],[6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],[6,28,54,80,106],[6,32,58,84,110],[6,30,58,86,114],[6,34,62,90,118],[6,26,50,74,98,122],[6,30,54,78,102,126],[6,26,52,78,104,130],[6,30,56,82,108,134],[6,34,60,86,112,138],[6,30,58,86,114,142],[6,34,62,90,118,146],[6,30,54,78,102,126,150],[6,24,50,76,102,128,154],[6,28,54,80,106,132,158],[6,32,58,84,110,136,162],[6,26,54,82,110,138,166],[6,30,58,86,114,142,170]];
const FORMAT_LEVEL_BITS:Record<Ecc,number>={L:1,M:0,Q:3,H:2};
const N3_PATTERN=[1,0,1,1,1,0,1];
const MASKS:((row:number,col:number)=>boolean)[]=[
 (r,c)=>(r+c)%2===0,
 r=>r%2===0,
 (_r,c)=>c%3===0,
 (r,c)=>(r+c)%3===0,
 (r,c)=>(Math.floor(r/2)+Math.floor(c/3))%2===0,
 (r,c)=>(r*c)%2+(r*c)%3===0,
 (r,c)=>((r*c)%2+(r*c)%3)%2===0,
 (r,c)=>((r+c)%2+(r*c)%3)%2===0
];

const GF_EXP=new Uint8Array(512),GF_LOG=new Uint8Array(256);
{let x=1;
 for(let i=0;i<255;i++){GF_EXP[i]=x;GF_LOG[x]=i;x<<=1;if(x&0x100)x^=0x11d;}
 for(let i=255;i<512;i++)GF_EXP[i]=GF_EXP[i-255];}

function gfMul(a:number,b:number):number{return a===0||b===0?0:GF_EXP[GF_LOG[a]+GF_LOG[b]];}

function rsRemainder(data:number[],degree:number):number[]{
 let gen:number[]=[1];
 for(let i=0;i<degree;i++){
  const next:number[]=new Array(gen.length+1).fill(0);
  for(let k=0;k<gen.length;k++)next[k]^=gen[k];
  for(let k=1;k<=gen.length;k++)next[k]^=gfMul(gen[k-1],GF_EXP[i]);
  gen=next;
 }
 const work=data.concat(new Array(degree).fill(0));
 for(let i=0;i<data.length;i++){
  const f=work[i];
  if(f===0)continue;
  for(let j=0;j<gen.length;j++)work[i+j]^=gfMul(gen[j],f);
 }
 return work.slice(data.length);
}

function dataCodewordCount(version:number,ecc:Ecc):number{
 return RS_BLOCKS[ecc][version-1].reduce((sum,[count,,data])=>sum+count*data,0);
}

export function qrTotalCodewordCount(version:number):number{
 return TOTAL_CW[version-1];
}

export function qrBlockCodewordCount(version:number,ecc:Ecc):number{
 return RS_BLOCKS[ecc][version-1].reduce((sum,[count,total])=>sum+count*total,0);
}

export function qrCapacityBytes(ecc:Ecc,version=40):number{
 const countBits=version<10?8:16;
 return Math.floor((dataCodewordCount(version,ecc)*8-4-countBits)/8);
}

function qrVersionForByteLength(length:number,ecc:Ecc):number|null{
 for(let version=1;version<=40;version++)
  if(length<=qrCapacityBytes(ecc,version))return version;
 return null;
}

export function qrFits(text:string,ecc:Ecc):boolean{
 return qrVersionForByteLength(new TextEncoder().encode(text).length,ecc)!==null;
}

export function qrPreferredEcc(text:string):Ecc|null{
 const length=new TextEncoder().encode(text).length;
 if(qrVersionForByteLength(length,'M')!==null)return 'M';
 if(qrVersionForByteLength(length,'L')!==null)return 'L';
 return null;
}

function buildCodewords(bytes:Uint8Array,version:number,ecc:Ecc):number[]{
 const capacity=dataCodewordCount(version,ecc)*8;
 const countBits=version<10?8:16;
 const bits:boolean[]=[];
 const push=(value:number,count:number)=>{
  for(let i=count-1;i>=0;i--)bits.push(((value>>>i)&1)!==0);
 };
 push(0b0100,4);
 push(bytes.length,countBits);
 for(const b of bytes)push(b,8);
 push(0,Math.min(4,capacity-bits.length));
 while(bits.length%8!==0)bits.push(false);
 const pads=[0xec,0x11];
 for(let p=0;bits.length<capacity;p++)push(pads[p%2],8);
 const codewords:number[]=[];
 for(let i=0;i<capacity;i+=8){
  let cw=0;
  for(let j=0;j<8;j++)if(bits[i+j])cw|=1<<(7-j);
  codewords.push(cw);
 }
 return codewords;
}

function interleave(version:number,ecc:Ecc,data:number[]):number[]{
 const groups=RS_BLOCKS[ecc][version-1];
 const dataBlocks:number[][]=[],ecBlocks:number[][]=[];
 let offset=0;
 for(const[count,totalWords,dataWords]of groups)for(let i=0;i<count;i++){
  const block=data.slice(offset,offset+dataWords);
  offset+=dataWords;
  dataBlocks.push(block);
  ecBlocks.push(rsRemainder(block,totalWords-dataWords));
 }
 const out:number[]=[];
 const maxLen=Math.max(...dataBlocks.map(b=>b.length));
 for(let c=0;c<maxLen;c++)for(const block of dataBlocks)if(c<block.length)out.push(block[c]);
 const maxEc=Math.max(...ecBlocks.map(b=>b.length));
 for(let c=0;c<maxEc;c++)for(const block of ecBlocks)if(c<block.length)out.push(block[c]);
 return out;
}

function buildFunctionGrid(version:number,size:number):{func:boolean[][];mod:boolean[][]}{
 const func:boolean[][]=Array.from({length:size},()=>new Array<boolean>(size).fill(false));
 const mod:boolean[][]=Array.from({length:size},()=>new Array<boolean>(size).fill(false));
 const set=(row:number,col:number,dark:boolean)=>{
  func[row][col]=true;
  mod[row][col]=dark;
 };
 for(const[top,left]of[[0,0],[0,size-7],[size-7,0]]){
  for(let r=top-1;r<=top+7;r++)for(let c=left-1;c<=left+7;c++)
   if(r>=0&&r<size&&c>=0&&c<size){func[r][c]=true;mod[r][c]=false;}
  for(let r=0;r<7;r++)for(let c=0;c<7;c++)
   set(top+r,left+c,Math.max(Math.abs(r-3),Math.abs(c-3))!==2);
 }
 for(let i=0;i<size;i++){
  if(!func[6][i])set(6,i,i%2===0);
  if(!func[i][6])set(i,6,i%2===0);
 }
 const pos=ALIGN_POS[version-1];
 for(let a=0;a<pos.length;a++)for(let b=0;b<pos.length;b++){
  if((a===0&&b===0)||(a===0&&b===pos.length-1)||(a===pos.length-1&&b===0))continue;
  for(let dr=-2;dr<=2;dr++)for(let dc=-2;dc<=2;dc++)
   set(pos[a]+dr,pos[b]+dc,Math.max(Math.abs(dr),Math.abs(dc))!==1);
 }
 set(size-8,8,false);
 const reserve=(row:number,col:number)=>{
  if(!func[row][col]){func[row][col]=true;mod[row][col]=false;}
 };
 for(let i=0;i<9;i++){
  if(i!==6)reserve(i,8);
  if(i!==6)reserve(8,i);
 }
 for(let i=1;i<=8;i++){
  reserve(size-i,8);
  reserve(8,size-i);
 }
 if(version>=7)for(let i=0;i<6;i++)for(let j=0;j<3;j++){
  reserve(i,size-11+j);
  reserve(size-11+j,i);
 }
 return{func,mod};
}

function placeData(mod:boolean[][],func:boolean[][],size:number,codewords:number[]):void{
 const totalBits=codewords.length*8;
 let bitIdx=0;
 for(let right=size-1;right>=1;right-=2){
  const r=right<=6?right-1:right;
  for(let vert=0;vert<size;vert++)for(let z=0;z<2;z++){
   const col=r-z;
   const upwards=((r&2)===0)!==(col<6);
   const row=upwards?size-1-vert:vert;
   if(!func[row][col]){
    mod[row][col]=bitIdx<totalBits?((codewords[bitIdx>>3]>>>(7-(bitIdx&7)))&1)!==0:false;
    bitIdx++;
   }
  }
 }
}

function penalty(m:boolean[][]):number{
 const n=m.length;
 let score=0;
 for(let i=0;i<n;i++){
  let rowRun=1,colRun=1;
  for(let j=1;j<n;j++){
   if(m[i][j]===m[i][j-1]){rowRun++;if(rowRun>=5)score+=rowRun===5?3:1;}else rowRun=1;
   if(m[j][i]===m[j-1][i]){colRun++;if(colRun>=5)score+=colRun===5?3:1;}else colRun=1;
  }
 }
 for(let i=1;i<n;i++)for(let j=1;j<n;j++)
  if(m[i][j]===m[i][j-1]&&m[i][j]===m[i-1][j]&&m[i][j]===m[i-1][j-1])score+=3;
 const n3=(get:(k:number)=>boolean)=>{
  let count=0,s=0;
  while(s+7<=n){
   let match=true;
   for(let k=0;k<7;k++)if(get(s+k)!==(N3_PATTERN[k]===1)){match=false;break;}
   if(!match){s++;continue;}
   let lightBefore=true,lightAfter=true;
   for(let k=Math.max(0,s-4);k<s;k++)if(get(k))lightBefore=false;
   for(let k=s+7;k<Math.min(n,s+11);k++)if(get(k))lightAfter=false;
   if(lightBefore||lightAfter){count+=40;s+=7;}
   else s+=4;
  }
  return count;
 };
 for(let i=0;i<n;i++){
  score+=n3(k=>m[i][k]);
  score+=n3(k=>m[k][i]);
 }
 let dark=0;
 for(let i=0;i<n;i++)for(let j=0;j<n;j++)if(m[i][j])dark++;
 score+=10*Math.floor(Math.abs(dark*100/(n*n)-50)/5);
 return score;
}

function drawFormat(mod:boolean[][],size:number,ecc:Ecc,mask:number):void{
 const data=FORMAT_LEVEL_BITS[ecc]<<3|mask;
 let rem=data;
 for(let i=0;i<10;i++)rem=(rem<<1)^((rem>>>9)*0x537);
 const bits=(data<<10|(rem&0x3ff))^0x5412;
 for(let i=0;i<8;i++){
  const vBit=((bits>>>i)&1)!==0,hBit=((bits>>>(14-i))&1)!==0;
  const p=i<6?i:i+1;
  mod[p][8]=vBit;
  mod[8][p]=hBit;
  mod[8][size-1-i]=vBit;
  mod[size-1-i][8]=hBit;
 }
 mod[size-8][8]=true;
}

function drawVersion(mod:boolean[][],size:number,version:number):void{
 let rem=version;
 for(let i=0;i<12;i++)rem=(rem<<1)^((rem>>>11)*0x1f25);
 const bits=version<<12|rem;
 for(let i=0;i<18;i++){
  const value=((bits>>>i)&1)!==0;
  const a=size-11+i%3,b=Math.floor(i/3);
  mod[a][b]=value;
  mod[b][a]=value;
 }
}

function assemble(version:number,ecc:Ecc,codewords:number[]):boolean[][]{
 const size=21+4*(version-1);
 const{func,mod}=buildFunctionGrid(version,size);
 placeData(mod,func,size,codewords);
 let best:boolean[][]=[],bestScore=Infinity,bestMask=0;
 for(let mask=0;mask<8;mask++){
  const candidate=mod.map(row=>row.slice());
  const fn=MASKS[mask];
  for(let r=0;r<size;r++)for(let c=0;c<size;c++)
   if(!func[r][c]&&fn(r,c))candidate[r][c]=!candidate[r][c];
  const score=penalty(candidate);
  if(score<bestScore){bestScore=score;best=candidate;bestMask=mask;}
 }
 drawFormat(best,size,ecc,bestMask);
 if(version>=7)drawVersion(best,size,version);
 best[size-8][8]=true;
 return best;
}

export function qrMatrix(text:string,ecc:Ecc='M'):boolean[][]{
 const bytes=new TextEncoder().encode(text);
 const version=qrVersionForByteLength(bytes.length,ecc);
 if(version===null)throw new Error('Text of '+bytes.length+' bytes does not fit QR version 40 at ECC level '+ecc+' (byte mode).');
 return assemble(version,ecc,interleave(version,ecc,buildCodewords(bytes,version,ecc)));
}

export interface QrSvgOptions{size?:number;margin?:number;ecc?:Ecc}

export function qrSvg(text:string,options:QrSvgOptions={}):string{
 const size=options.size??4,margin=options.margin??4;
 const matrix=qrMatrix(text,options.ecc??'M');
 const dimension=(matrix.length+2*margin)*size;
 const rects:string[]=[];
 for(let r=0;r<matrix.length;r++)for(let c=0;c<matrix.length;c++)
  if(matrix[r][c])
   rects.push(`<rect x="${(c+margin)*size}" y="${(r+margin)*size}" width="${size}" height="${size}"/>`);
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${dimension}" height="${dimension}" viewBox="0 0 ${dimension} ${dimension}" shape-rendering="crispEdges">${rects.join('')}</svg>`;
}
