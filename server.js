'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 5500);
const N8N_CHAT_URL = process.env.N8N_CHAT_URL ||
  'http://127.0.0.1:5678/webhook/eda3d47f-7789-408c-bf40-8abd43a2f7a1/chat';
const REQUEST_TIMEOUT = 110000;
const MAX_BYTES = 16000;

const sendJSON = (res, status, payload) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
};
const sendHTML = (res) => {
  fs.readFile(path.join(__dirname,'index.html'), (err, data) => {
    if (err) return sendJSON(res,500,{error:'No se encuentra index.html.'});
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(data);
  });
};
http.createServer(async (req, res) => {
  let pathname;
  try { pathname = new URL(req.url, `http://localhost:${PORT}`).pathname; }
  catch { return sendJSON(res,400,{error:'Solicitud inválida.'}); }
  if(req.method==='GET' && (pathname==='/' || pathname==='/index.html')) return sendHTML(res);
  if(req.method==='GET' && pathname==='/api/health') return sendJSON(res,200,{ok:true,service:'OPORTUNIA IA'});
  if(req.method!=='POST' || pathname!=='/api/buscar') return sendJSON(res,404,{error:'Ruta no encontrada.'});
  let body = '';
  try {
    for await(const chunk of req) {
      body += chunk.toString('utf8');
      if(Buffer.byteLength(body,'utf8')>MAX_BYTES) return sendJSON(res,413,{error:'Consulta demasiado larga.'});
    }
    const {chatInput,sessionId} = JSON.parse(body);
    if(typeof chatInput!=='string' || chatInput.trim().length<10 || chatInput.length>6000 ||
       typeof sessionId!=='string' || !/^[\w-]{10,100}$/.test(sessionId)) {
      return sendJSON(res,400,{error:'Revisa la información del formulario.'});
    }
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(), REQUEST_TIMEOUT);
    let response;
    try {
      response = await fetch(N8N_CHAT_URL, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'sendMessage',sessionId,chatInput}),
        signal:controller.signal,
      });
    } finally {clearTimeout(timer);}
    const text = await response.text();
    if(!response.ok) {
      let reason = 'n8n no pudo completar la consulta.';
      if(response.status===404) reason='No se encontró el Chat Trigger. Comprueba que el workflow esté publicado y que la Chat URL siga vigente.';
      else if(response.status===429) reason='La cuota de solicitudes del servicio de IA está agotada. Intenta más tarde o usa un modelo con cuota disponible.';
      else if(response.status>=500) reason='El workflow de n8n falló. Revisa Executions: puede ser un límite de Gemini, Tavily o un error del agente.';
      return sendJSON(res,502,{error:reason,upstreamStatus:response.status});
    }
    let data;
    try {data=JSON.parse(text);} catch {data={output:text};}
    sendJSON(res,200,{ok:true,data});
  } catch(err) {
    const aborted=err?.name==='AbortError';
    sendJSON(res,aborted?504:502,{
      error:aborted?'n8n tardó demasiado en responder. Consulta la última ejecución en n8n.':
        'No fue posible conectar con n8n. Asegúrate de que http://localhost:5678 esté funcionando.',
    });
  }
}).listen(PORT,'127.0.0.1',()=>{
  console.log('\n  OPORTUNIA IA | Web rediseñada');
  console.log(`  Abre http://localhost:${PORT}`);
  console.log('  n8n integrado, sin formulario de URL.\n');
});
