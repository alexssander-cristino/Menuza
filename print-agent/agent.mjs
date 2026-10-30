import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync=promisify(execFile);
const PORT=Number(process.env.PRINT_AGENT_PORT||17891);
const TYPE=String(process.env.PRINTER_TYPE||'windows').toLowerCase();
const PRINTER_NAME=String(process.env.PRINTER_NAME||'').trim();
const PRINTER_HOST=String(process.env.PRINTER_HOST||'').trim();
const PRINTER_PORT=Number(process.env.PRINTER_PORT||9100);
const ALLOWED_ORIGINS=new Set((process.env.ALLOWED_ORIGINS||'https://menuza-five.vercel.app,https://menuza-alexssander1.vercel.app,https://menuza-git-main-alexssander1.vercel.app,http://localhost:4173,http://127.0.0.1:4173').split(',').map(v=>v.trim()).filter(Boolean));
const STATE_DIR=path.join(os.homedir(),'.menuza-print-agent');
const STATE_FILE=path.join(STATE_DIR,'printed-orders.json');
let printed=new Set();

await fs.mkdir(STATE_DIR,{recursive:true});
try{printed=new Set(JSON.parse(await fs.readFile(STATE_FILE,'utf8')).ids||[])}catch{}
const saveState=async()=>{const ids=[...printed].slice(-2000);await fs.writeFile(STATE_FILE,JSON.stringify({ids},null,2),'utf8');printed=new Set(ids)};

const clean=value=>String(value??'').replace(/[\\r\\n\\t]+/g,' ').replace(/\s{2,}/g,' ').trim();
const ascii=value=>clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7E]/g,'?');
function ticket(order){
  const lines=['================================', '             MENUZA', '        COMANDA DE COZINHA', '================================',
    'PEDIDO: '+ascii(order.id),'DATA: '+ascii(order.createdAt?new Date(order.createdAt).toLocaleString('pt-BR'):''),
    'CLIENTE: '+ascii(order.customerName||'Nao informado'),
    'TIPO: '+ascii(order.fulfillment==='table'?'MESA '+(order.tableLabel||''):order.fulfillment==='delivery'?'ENTREGA':'RETIRADA')];
  if(order.phone)lines.push('TELEFONE: '+ascii(order.phone));
  lines.push('--------------------------------','ITENS');
  for(const item of order.items||[]){
    lines.push(ascii((item.quantity||1)+'x '+item.name));
    const size=item.snapshot?.size?.label||item.sizeLabel;
    if(size)lines.push('  Tamanho: '+ascii(size));
    const ingredients=(item.ingredients||[]).map(i=>i.name).filter(Boolean);
    if(ingredients.length)lines.push('  Adicionais: '+ascii(ingredients.join(', ')));
    if(item.notes)lines.push('  OBS: '+ascii(item.notes));
  }
  if(order.note)lines.push('--------------------------------','OBSERVACAO: '+ascii(order.note));
  if(order.fulfillment==='delivery'&&order.deliveryAddress)lines.push('ENDERECO: '+ascii(order.deliveryAddress));
  lines.push('--------------------------------','TOTAL: '+ascii((Number(order.totalCents||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})),'================================','','');
  return lines.join('\n');
}
async function printWindows(text){
  const file=path.join(os.tmpdir(),'menuza-'+Date.now()+'.txt');
  await fs.writeFile(file,'\uFEFF'+text,'utf8');
  try{
    const script=PRINTER_NAME
      ? 'Get-Content -LiteralPath $args[0] -Raw | Out-Printer -Name $args[1]'
      : 'Get-Content -LiteralPath $args[0] -Raw | Out-Printer';
    await execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script,file,...(PRINTER_NAME?[PRINTER_NAME]:[])],{timeout:20000,windowsHide:true});
  }finally{await fs.rm(file,{force:true})}
}
async function printNetwork(text){
  if(!PRINTER_HOST)throw new Error('Configure PRINTER_HOST no arquivo .env do agente.');
  const data=Buffer.concat([Buffer.from([0x1b,0x40]),Buffer.from(text,'ascii'),Buffer.from([0x0a,0x0a,0x0a,0x1d,0x56,0x00])]);
  await new Promise((resolve,reject)=>{
    const socket=net.createConnection({host:PRINTER_HOST,port:PRINTER_PORT,timeout:8000});
    socket.once('connect',()=>socket.end(data));
    socket.once('close',resolve);socket.once('error',reject);socket.once('timeout',()=>socket.destroy(new Error('Tempo esgotado ao conectar à impressora.')));
  });
}
async function printOrder(order){
  if(TYPE==='network'||TYPE==='ethernet'||TYPE==='wifi')return printNetwork(ticket(order));
  if(TYPE==='windows'||TYPE==='usb')return printWindows(ticket(order));
  throw new Error('PRINTER_TYPE deve ser windows ou network.');
}
function json(res,status,payload){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(payload))}
const server=http.createServer(async(req,res)=>{
  const origin=req.headers.origin||'';
  if(req.method==='OPTIONS'){
    if(!ALLOWED_ORIGINS.has(origin)){res.writeHead(403);return res.end()}
    res.writeHead(204,{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Methods':'POST, GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type'});return res.end();
  }
  if(origin&&!ALLOWED_ORIGINS.has(origin))return json(res,403,{error:'Origem não autorizada.'});
  res.setHeader('Access-Control-Allow-Origin',origin||'null');res.setHeader('Vary','Origin');
  if(req.method==='GET'&&req.url==='/health')return json(res,200,{ok:true,printerType:TYPE,configured:TYPE==='network'?Boolean(PRINTER_HOST):true});
  if(req.method!=='POST'||req.url!=='/print')return json(res,404,{error:'Rota não encontrada.'});
  let raw='';req.on('data',chunk=>{raw+=chunk;if(raw.length>250000){req.destroy()}});req.on('end',async()=>{
    try{
      const body=JSON.parse(raw||'{}'),order=body.order;
      if(!order||!order.id||!Array.isArray(order.items)||order.items.length>100)throw new Error('Dados da comanda inválidos.');
      if(order.status!=='received')return json(res,200,{ok:true,duplicate:true,skipped:true});
      const id=String(order.id);
      if(printed.has(id))return json(res,200,{ok:true,duplicate:true});
      await printOrder(order);
      printed.add(id);await saveState();
      return json(res,200,{ok:true,printed:true,orderId:id});
    }catch(error){return json(res,500,{error:error.message||'Falha ao imprimir comanda.'})}
  });
});
server.listen(PORT,'127.0.0.1',()=>console.log('[Menuza Print Agent] ativo em http://127.0.0.1:'+PORT+' | tipo: '+TYPE));
