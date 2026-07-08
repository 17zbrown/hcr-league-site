import Jimp from 'jimp'
import potrace from 'potrace'
import { writeFileSync } from 'node:fs'

const src = await Jimp.read('HCR-logo.png')
const { width: W, height: H, data } = src.bitmap

// tight crop to content
let minX=W,minY=H,maxX=0,maxY=0
for (let y=0;y<H;y++) for(let x=0;x<W;x++){
  const a=data[(y*W+x)*4+3]
  if(a>40){ if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y }
}
const pad=10
minX=Math.max(0,minX-pad); minY=Math.max(0,minY-pad)
maxX=Math.min(W-1,maxX+pad); maxY=Math.min(H-1,maxY+pad)
const cw=maxX-minX+1, ch=maxY-minY+1

function mask(kind){
  const m = new Jimp(cw, ch, 0xffffffff) // white bg
  for(let y=0;y<ch;y++) for(let x=0;x<cw;x++){
    const i=((y+minY)*W+(x+minX))*4
    const r=data[i],g=data[i+1],b=data[i+2],a=data[i+3]
    let hit=false
    if(a>90){
      const isYellow = r>165 && g>140 && b<135
      if(kind==='R') hit=isYellow
      else hit=!isYellow // HC = opaque, not yellow
    }
    if(hit) m.setPixelColor(0x000000ff, x, y) // black shape
  }
  return m
}

function trace(img){
  return new Promise((res,rej)=>{
    img.getBuffer(Jimp.MIME_PNG, (err,buf)=>{
      if(err) return rej(err)
      potrace.trace(buf, { threshold: 128, turdSize: 4, optTolerance: 0.35, turnPolicy: 'minority' }, (e,svg)=>{
        if(e) return rej(e)
        const d = (svg.match(/ d="([^"]+)"/)||[])[1] || ''
        res(d)
      })
    })
  })
}

const dHC = await trace(mask('HC'))
const dR = await trace(mask('R'))
console.log('HC path len', dHC.length, 'R path len', dR.length)

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cw} ${ch}">
<path fill="#eef1f5" d="${dHC}"/>
<path fill="#f2e114" d="${dR}"/>
</svg>`
writeFileSync('src/assets/hcr-logo-3d.svg', svg)
console.log('wrote src/assets/hcr-logo-3d.svg', cw,'x',ch)
