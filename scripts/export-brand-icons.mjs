// Run with: npx electron scripts/export-brand-icons.mjs
// Rasterizes the vector app icons in public/images/brand into PNGs and the Windows .ico.
// Square PNGs keep the full-bleed background (OS masks them); the .ico uses a 22% rounded
// tile with transparent corners, as in the Claude Design logo board.
import {app,BrowserWindow} from 'electron';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

const brand=resolve(import.meta.dirname,'..','public','images','brand');
const icoSizes=[16,20,24,32,40,48,64,128,256];
const svgOf=name=>readFileSync(resolve(brand,`mainsagents-appicon-${name}.svg`),'utf8');
const rounded=svg=>svg.replace(/<rect width="1024" height="1024"/,'<rect width="1024" height="1024" rx="225"');

app.commandLine.appendSwitch('force-device-scale-factor','1');
let window;

async function render(svg,size){
  const html=`<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden"><img id="i" width="${size}" height="${size}" style="display:block" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body></html>`;
  window.setContentSize(size,size);
  await window.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  await window.webContents.executeJavaScript('document.getElementById("i").decode()');
  await new Promise(r=>setTimeout(r,120));
  const image=await window.webContents.capturePage({x:0,y:0,width:size,height:size});
  return image.resize({width:size,height:size,quality:'best'}).toPNG();
}

function ico(pngs){
  const header=Buffer.alloc(6);header.writeUInt16LE(0,0);header.writeUInt16LE(1,2);header.writeUInt16LE(pngs.length,4);
  const entries=[];let offset=6+16*pngs.length;
  for(const {size,data} of pngs){
    const entry=Buffer.alloc(16);
    entry.writeUInt8(size>=256?0:size,0);entry.writeUInt8(size>=256?0:size,1);entry.writeUInt8(0,2);entry.writeUInt8(0,3);
    entry.writeUInt16LE(1,4);entry.writeUInt16LE(32,6);entry.writeUInt32LE(data.length,8);entry.writeUInt32LE(offset,12);
    entries.push(entry);offset+=data.length;
  }
  return Buffer.concat([header,...entries,...pngs.map(item=>item.data)]);
}

app.whenReady().then(async()=>{try{
  window=new BrowserWindow({show:false,width:1024,height:1024,frame:false,transparent:true,useContentSize:true,webPreferences:{offscreen:true,backgroundThrottling:false}});
  for(const name of ['black','light','cobalt','violet'])writeFileSync(resolve(brand,`mainsagents-appicon-${name}.png`),await render(svgOf(name),1024));
  const tile=rounded(svgOf('black'));
  writeFileSync(resolve(brand,'mainsagents-favicon-64.png'),await render(tile,64));
  const pngs=[];for(const size of icoSizes)pngs.push({size,data:await render(tile,size)});
  writeFileSync(resolve(brand,'mainsagents-icon-black.ico'),ico(pngs));
  console.log('BRAND_ICONS_OK',icoSizes.join(','));
}catch(error){console.error(error);process.exitCode=1}finally{app.quit();}});
