export type Ecc='L'|'M'|'Q'|'H';

const TOTAL_CW=[26,44,70,100,134,172,196,242,292,346];
const RS_BLOCKS:Record<Ecc,[number,number][][]>={
 L:[[[1,19]],[[1,34]],[[1,55]],[[1,80]],[[1,108]],[[2,68]],[[2,78]],[[2,97]],[[2,116]],[[2,68],[2,69]]],
 M:[[[1,16]],[[1,28]],[[1,44]],[[2,32]],[[2,43]],[[4,27]],[[4,31]],[[2,38],[2,39]],[[3,36],[2,37]],[[4,43],[1,44]]],
 Q:[[[1,13]],[[1,22]],[[2,17]],[[2,24]],[[2,15],[2,16]],[[4,19]],[[2,14],[4,15]],[[4,18],[2,19]],[[4,16],[4,17]],[[6,19],[2,20]]],
 H:[[[1,9]],[[1,16]],[[2,13]],[[4,9]],[[2,11],[2,12]],[[4,15]],[[4,13],[1,14]],[[4,14],[2,15]],[[4,12],[4,13]],[[6,15],[2,16]]]
};
const ALIGN_POS:number[][]=[[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50]];
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
 return RS_BLOCKS[ecc][version-1].reduce((sum,[count,len])=>sum+count*len,0);
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
 bits.length-=bits.length%8;
 bits.length+=8-(bits.length%8);
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
 const blockCount=groups.reduce((sum,[count])=>sum+count,0);
 const ecPer=(TOTAL_CW[version-1]-dataCodewordCount(version,ecc))/blockCount;
 const dataBlocks:number[][]=[],ecBlocks:number[][]=[];
 let offset=0;
 for(const[count,len]of groups)for(let i=0;i<count;i++){
  const block=data.slice(offset,offset+len);
  offset+=len;
  dataBlocks.push(block);
  ecBlocks.push(rsRemainder(block,ecPer));
 }
 const out:number[]=[];
 const maxLen=Math.max(...dataBlocks.map(b=>b.length));
 for(let c=0;c<maxLen;c++)for(const block of dataBlocks)if(c<block.length)out.push(block[c]);
 for(let c=0;c<ecPer;c++)for(const block of ecBlocks)out.push(block[c]);
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
 set(size-8,8,true);
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
   const upwards=(((r+1)&2)===0)!==(col<6);
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
   if(m[i][j]===m[i][j-1]){rowRun++;if(rowRun>=5)score++;}else rowRun=1;
   if(m[j][i]===m[j-1][i]){colRun++;if(colRun>=5)score++;}else colRun=1;
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
 for(let version=1;version<=10;version++){
  const countBits=version<10?8:16;
  if(4+countBits+bytes.length*8<=dataCodewordCount(version,ecc)*8)
   return assemble(version,ecc,interleave(version,ecc,buildCodewords(bytes,version,ecc)));
 }
 throw new Error(`Text of ${bytes.length} bytes does not fit QR version 10 at ECC level ${ecc} (byte mode).`);
}

export function __debug(text:string,ecc:Ecc):{version:number;mask:number;codewords:number[];mod:boolean[][];func:boolean[][];scores:number[]}{
 const bytes=new TextEncoder().encode(text);
 let version=1;
 for(;version<=10;version++){
  const countBits=version<10?8:16;
  if(4+countBits+bytes.length*8<=dataCodewordCount(version,ecc)*8)break;
 }
 const codewords=interleave(version,ecc,buildCodewords(bytes,version,ecc));
 const size=21+4*(version-1);
 const{func,mod}=buildFunctionGrid(version,size);
 placeData(mod,func,size,codewords);
 const scores:number[]=[];
 for(let mask=0;mask<8;mask++){
  const candidate=mod.map(row=>row.slice());
  const fn=MASKS[mask];
  for(let r=0;r<size;r++)for(let c=0;c<size;c++)
   if(!func[r][c]&&fn(r,c))candidate[r][c]=!candidate[r][c];
  scores.push(penalty(candidate));
 }
 return{version,mask:-1,codewords,mod,func,scores};
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
