// QlikBase backend. Run: node server.js   (Node 18+, no npm install needed)
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=process.env.PORT||3000,ROOT=__dirname,DATA=process.env.DATA_DIR||ROOT,F=path.join(DATA,'data.json'),UP=path.join(DATA,'uploads'),PUB=path.join(ROOT,'public');
fs.mkdirSync(DATA,{recursive:true});
let D={projects:{},vers:{},secret:crypto.randomBytes(24).toString('hex'),admin:crypto.randomBytes(4).toString('hex')};
if(fs.existsSync(F))try{D=Object.assign(D,JSON.parse(fs.readFileSync(F)))}catch(e){}
if(process.env.ADMIN_PASS)D.admin=process.env.ADMIN_PASS;
let dirty=true;const save=()=>{dirty=true},flush=()=>{if(dirty){dirty=false;fs.writeFileSync(F,JSON.stringify(D))}};
setInterval(flush,1000);process.on('SIGINT',()=>{flush();process.exit()});process.on('SIGTERM',()=>{flush();process.exit()});
fs.mkdirSync(UP,{recursive:true});
console.log('QlikBase running on port '+PORT+'\nAdmin password: '+D.admin);
const id=n=>crypto.randomBytes(n).toString('hex'),OTP={},L=[],N=[];
const bump=pid=>{D.vers[pid]=(D.vers[pid]||0)+1;save()};
const parts=p=>p.split('/').filter(Boolean).map(decodeURIComponent);
const getp=(t,p)=>{const v=p.reduce((a,k)=>a==null?null:a[k],t);return v==null?null:v};
function setp(t,p,v){if(!p.length)return v;let a=t;p.slice(0,-1).forEach(k=>{if(typeof a[k]!=='object'||a[k]===null)a[k]={};a=a[k]});const l=p[p.length-1];if(v===null)delete a[l];else a[l]=v;return t}
const rel=(a,b)=>{const n=Math.min(a.length,b.length);return a.slice(0,n).every((k,i)=>k===b[i])};
const emit=(pid,p)=>L.filter(l=>l.pid===pid&&rel(l.p,p)).forEach(l=>l.res.write('data:'+JSON.stringify({path:'/'+l.p.join('/'),value:getp(D.projects[pid].db,l.p)})+'\n\n'));
setInterval(()=>[...L,...N].forEach(l=>l.res.write(': ping\n\n')),25000);
const body=(req,max=5e7)=>new Promise((ok,no)=>{const c=[];let n=0;req.on('data',d=>{n+=d.length;if(n>max){no(new Error('too big'));req.destroy()}else c.push(d)});req.on('end',()=>ok(Buffer.concat(c)))});
const J=(res,c,o)=>{res.writeHead(c,{'content-type':'application/json'});res.end(JSON.stringify(o))};
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml','.pdf':'application/pdf','.mp4':'video/mp4','.mp3':'audio/mpeg','.json':'application/json','.txt':'text/plain; charset=utf-8'};
const mime=f=>MIME[path.extname(f).toLowerCase()]||'application/octet-stream';
const sendFile=(res,f)=>{if(!fs.existsSync(f)||fs.statSync(f).isDirectory())return false;res.writeHead(200,{'content-type':mime(f)});fs.createReadStream(f).pipe(res);return true};
const sign=(pid,uid,exp)=>crypto.createHmac('sha256',D.secret).update(pid+uid+exp).digest('hex');
const tok=(pid,u)=>{const exp=Date.now()+30*864e5;return{user:{uid:u.uid,email:u.email,phone:u.phone,name:u.name,provider:u.provider},token:u.uid+'.'+exp+'.'+sign(pid,u.uid,exp)}};
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const pwOk=(u,pw)=>u.salt?crypto.scryptSync(pw,u.salt,32).toString('hex')===u.hash:sha(pw)===u.hash;
const form=o=>Object.entries(o).map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&');

async function sendSms(pj,phone,code){
  const s=pj.auth.sms||{},msg='Your verification code is '+code;
  if(s.provider==='Twilio'){const[sid,tk,from]=(s.key||'').split(':');const r=await fetch('https://api.twilio.com/2010-04-01/Accounts/'+sid+'/Messages.json',{method:'POST',headers:{authorization:'Basic '+Buffer.from(sid+':'+tk).toString('base64'),'content-type':'application/x-www-form-urlencoded'},body:form({To:phone,From:from,Body:msg})});return r.ok}
  if(s.provider==='Custom SMS API'){const r=await fetch(s.key,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone,message:msg,code})});return r.ok}
  return false}
async function forward(pj,n){const m=pj.msg||{};if(!m.key||!m.provider||m.provider==='None')return'Local';
  try{
    if(m.provider==='OneSignal'){const[app,key]=m.key.split(':');const r=await fetch('https://onesignal.com/api/v1/notifications',{method:'POST',headers:{'content-type':'application/json',authorization:'Basic '+key},body:JSON.stringify({app_id:app,included_segments:['All'],headings:{en:n.title||' '},contents:{en:n.body||' '}})});return r.ok?'Sent (OneSignal)':'OneSignal error '+r.status}
    if(m.provider==='FCM'){const sa=JSON.parse(m.key),now=Math.floor(Date.now()/1000),b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
      const u=b64({alg:'RS256',typ:'JWT'})+'.'+b64({iss:sa.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
      const sig=crypto.createSign('RSA-SHA256').update(u).sign(sa.private_key,'base64url');
      const t=await(await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:u+'.'+sig})})).json();
      const topic=(n.target||'').startsWith('Topic: ')?n.target.slice(7):'all';
      const r=await fetch('https://fcm.googleapis.com/v1/projects/'+sa.project_id+'/messages:send',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+t.access_token},body:JSON.stringify({message:{topic,notification:{title:n.title,body:n.body}}})});return r.ok?'Sent (FCM)':'FCM error '+r.status}
    if(m.provider==='Custom'){const r=await fetch(m.key,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(n)});return r.ok?'Sent (webhook)':'Webhook error '+r.status}
  }catch(e){return'Failed: '+e.message}
  return'Local'}

http.createServer(async(req,res)=>{
res.setHeader('access-control-allow-origin','*');res.setHeader('access-control-allow-headers','*');res.setHeader('access-control-allow-methods','*');
if(req.method==='OPTIONS'){res.writeHead(204);return res.end()}
const u=new URL(req.url,'http://x'),q=u.searchParams,P=u.pathname,H=req.headers,M=(q.get('_method')||req.method).toUpperCase();
try{
const adm=(H['x-admin']||q.get('admin'))===D.admin;
if(P==='/'||P==='/index.html'){if(!sendFile(res,path.join(ROOT,'index.html')))J(res,404,{error:'index.html (console) missing'});return}
if(P==='/site'||P.startsWith('/site/')){let r=P.slice(5)||'/';if(r.endsWith('/'))r+='index.html';const f=path.join(PUB,path.normalize(r));if(!f.startsWith(PUB)||!sendFile(res,f))J(res,404,{error:'not found'});return}
let m=P.match(/^\/files\/([^/]+)\/(.+)$/);
if(m){if(!sendFile(res,path.join(UP,path.basename(m[1]),path.basename(decodeURIComponent(m[2])))))J(res,404,{error:'not found'});return}

/* ---------- admin (used by the console) ---------- */
if(P.startsWith('/admin/')){
  if(!adm)return J(res,401,{error:'wrong admin password'});
  if(P==='/admin/ping')return J(res,200,{ok:true,projects:Object.keys(D.projects)});
  m=P.match(/^\/admin\/project\/([^/]+)(\/ver)?$/);
  if(m){const pid=m[1];
    if(m[2])return J(res,200,{ver:D.vers[pid]||0,exists:!!D.projects[pid]});
    if(M==='GET')return D.projects[pid]?J(res,200,{ver:D.vers[pid]||0,project:D.projects[pid]}):J(res,404,{error:'no project'});
    if(M==='PUT'){const have=D.vers[pid]||0;if(D.projects[pid]&&String(have)!==String(H['x-ver']))return J(res,409,{error:'changed elsewhere',ver:have});
      D.projects[pid]=JSON.parse((await body(req)).toString());bump(pid);return J(res,200,{ver:D.vers[pid]})}
    if(M==='DELETE'){delete D.projects[pid];delete D.vers[pid];fs.rmSync(path.join(UP,path.basename(pid)),{recursive:true,force:true});save();return J(res,200,{ok:true})}}
  return J(res,404,{error:'not found'})}

/* ---------- app API (x-api-key = the app key from the console) ---------- */
if(P.startsWith('/api/')){
  const key=H['x-api-key']||q.get('key');
  let pid=key&&Object.keys(D.projects).find(i=>(D.projects[i].apps||[]).some(a=>a.apiKey===key));
  if(!pid&&adm&&D.projects[H['x-project']||q.get('project')])pid=H['x-project']||q.get('project');
  if(!pid)return J(res,401,{error:'invalid api key'});
  const pj=D.projects[pid],r=P.slice(5),jb=async()=>JSON.parse((await body(req)).toString()||'{}');
  pj.db=pj.db||{};pj.users=pj.users||[];pj.notifs=pj.notifs||[];pj.auth=pj.auth||{};pj.msg=pj.msg||{};
  const dir=path.join(UP,path.basename(pid));fs.mkdirSync(dir,{recursive:true});

  if(r==='overview')return J(res,200,{users:pj.users.length,files:fs.readdirSync(dir).length,notifications:pj.notifs.length});

  /* ----- authentication ----- */
  if(r.startsWith('auth/')){
    const a=pj.auth,fin=(us,created)=>{if(us.off)return J(res,403,{error:'user disabled'});if(created)bump(pid);return J(res,200,tok(pid,us))};
    if(r==='auth/me'){const[uid,exp,sig]=(H.authorization||'').replace('Bearer ','').split('.');const us=pj.users.find(x=>x.uid===uid);
      if(!us||Date.now()>+exp||sig!==sign(pid,uid,exp))return J(res,401,{error:'invalid token'});return J(res,200,tok(pid,us).user)}
    if(M!=='POST')return J(res,405,{error:'use POST'});
    const b=await jb();
    if(r==='auth/signup'||r==='auth/signin'){
      if(!a.email)return J(res,403,{error:'email sign-in is disabled'});
      const em=(b.email||'').toLowerCase().trim();if(!em||!b.password)return J(res,400,{error:'email and password required'});
      let us=pj.users.find(x=>x.email===em);
      if(r==='auth/signup'){if(us)return J(res,409,{error:'email already used'});if(b.password.length<6)return J(res,400,{error:'password too short'});
        const salt=id(8);us={uid:id(10),email:em,provider:'email',salt,hash:crypto.scryptSync(b.password,salt,32).toString('hex'),created:Date.now(),off:false};pj.users.push(us);return fin(us,true)}
      if(!us||!pwOk(us,b.password))return J(res,401,{error:'wrong email or password'});return fin(us)}
    if(r==='auth/phone/send'){
      if(!a.phone)return J(res,403,{error:'phone sign-in is disabled'});
      const ph=(b.phone||'').trim();if(!/^\+\d{8,15}$/.test(ph))return J(res,400,{error:'use international format, e.g. +8801712345678'});
      const t=(a.tests||[]).find(x=>x.phone===ph),code=t?t.code:String(crypto.randomInt(1e5,1e6));
      if(!t&&!await sendSms(pj,ph,code))return J(res,400,{error:'SMS not sent. Set an SMS provider in the console, or add this number as a test number'});
      OTP[pid+ph]={code,exp:Date.now()+6e5,tries:0};return J(res,200,{ok:true,test:!!t})}
    if(r==='auth/phone/verify'){
      const ph=(b.phone||'').trim(),o=OTP[pid+ph];
      if(!o||Date.now()>o.exp||++o.tries>5)return J(res,400,{error:'code expired, request a new one'});
      if(String(b.code).trim()!==o.code)return J(res,401,{error:'wrong code'});
      delete OTP[pid+ph];let us=pj.users.find(x=>x.phone===ph),created=false;
      if(!us){us={uid:id(10),phone:ph,provider:'phone',created:Date.now(),off:false};pj.users.push(us);created=true}return fin(us,created)}
    if(r==='auth/facebook'){
      const fb=a.fb||{};if(!a.facebook||!fb.appId||!fb.secret)return J(res,403,{error:'Facebook sign-in is not configured'});
      const t=encodeURIComponent(b.accessToken||''),dbg=await(await fetch('https://graph.facebook.com/debug_token?input_token='+t+'&access_token='+encodeURIComponent(fb.appId+'|'+fb.secret))).json();
      if(!dbg.data||!dbg.data.is_valid||String(dbg.data.app_id)!==String(fb.appId))return J(res,401,{error:'invalid Facebook token'});
      const me=await(await fetch('https://graph.facebook.com/me?fields=id,name,email&access_token='+t)).json();
      let us=pj.users.find(x=>x.fbId===me.id),created=false;
      if(!us){us={uid:id(10),fbId:me.id,name:me.name,email:me.email,provider:'facebook',created:Date.now(),off:false};pj.users.push(us);created=true}return fin(us,created)}
    return J(res,404,{error:'not found'})}

  /* ----- notifications ----- */
  if(r==='notify'&&M==='POST'){const b=await jb(),n={id:id(4),title:b.title||'',body:b.body||'',target:b.target||'All users',time:Date.now(),status:'Local'};
    n.status=await forward(pj,n);pj.notifs.unshift(n);pj.notifs=pj.notifs.slice(0,200);bump(pid);
    N.filter(l=>l.pid===pid).forEach(l=>l.res.write('data:'+JSON.stringify(n)+'\n\n'));return J(res,200,n)}
  if(r==='notify'&&M==='GET')return J(res,200,pj.notifs);
  if(r==='notify/stream'){res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});res.write(': ok\n\n');const l={pid,res};N.push(l);req.on('close',()=>N.splice(N.indexOf(l),1));return}

  /* ----- storage ----- */
  if(r==='storage'&&M==='GET')return J(res,200,fs.readdirSync(dir).map(f=>{const s=fs.statSync(path.join(dir,f));return{name:f,size:s.size,time:s.mtimeMs,type:mime(f),url:'/files/'+pid+'/'+encodeURIComponent(f)}}));
  m=r.match(/^storage\/(.+)$/);
  if(m){const f=path.join(dir,path.basename(decodeURIComponent(m[1])));
    if(M==='PUT'||M==='POST'){fs.writeFileSync(f,await body(req));return J(res,200,{name:path.basename(f),url:'/files/'+pid+'/'+encodeURIComponent(path.basename(f))})}
    if(M==='DELETE'){fs.rmSync(f,{force:true});return J(res,200,{ok:true})}}

  /* ----- realtime database ----- */
  m=r.match(/^stream(\/.*)?$/);
  if(m){const p=parts(m[1]||'');res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});res.write('data:'+JSON.stringify({path:'/'+p.join('/'),value:getp(pj.db,p)})+'\n\n');const l={pid,p,res};L.push(l);req.on('close',()=>L.splice(L.indexOf(l),1));return}
  m=r.match(/^db(\/.*)?$/);
  if(m){const p=parts(m[1]||'');
    if(M==='GET')return J(res,200,getp(pj.db,p));
    if(M==='DELETE')pj.db=setp(pj.db,p,null)||{};
    else{const v=JSON.parse((await body(req)).toString()||'null');
      if(M==='POST'){const k=Date.now().toString(36)+id(2);pj.db=setp(pj.db,[...p,k],v);bump(pid);emit(pid,[...p,k]);return J(res,200,{key:k})}
      if(M==='PATCH'&&v&&typeof v==='object'){const cur=getp(pj.db,p);pj.db=setp(pj.db,p,Object.assign(typeof cur==='object'&&cur?cur:{},v))}
      else pj.db=setp(pj.db,p,v)}
    if(!pj.db||typeof pj.db!=='object')pj.db={};
    bump(pid);emit(pid,p);return J(res,200,{ok:true})}
  return J(res,404,{error:'not found'})}
J(res,404,{error:'not found'});
}catch(e){J(res,500,{error:String(e.message||e)})}
}).listen(PORT,'0.0.0.0');
