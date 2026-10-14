import express from 'express';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import axios from 'axios';
import FormData from 'form-data';
import cron from 'node-cron';
import sql from 'mssql';
import {SocksProxyAgent} from 'socks-proxy-agent';

const root=path.dirname(fileURLToPath(import.meta.url));
const app=express();
const dataDir=path.resolve(process.env.DATA_DIR || path.join(root,'data'));
const confFile=path.join(dataDir,'config.enc');
const backupDir=path.join(dataDir,'backups');
await fsp.mkdir(backupDir,{recursive:true,mode:0o700});
const sessionSecret = process.env.SESSION_SECRET || 'liara-backup-default-session-secret-9876543210';
const adminPassword = process.env.ADMIN_PASSWORD || 'admin12345678';
const encryptionKeyHex = (/^[a-fA-F0-9]{64}$/.test(process.env.ENCRYPTION_KEY || ''))
  ? process.env.ENCRYPTION_KEY
  : '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
if (!process.env.SESSION_SECRET || !process.env.ADMIN_PASSWORD || !process.env.ENCRYPTION_KEY) {
  console.warn('[AI Studio] Notice: Running with fallback credentials. Default admin password: admin12345678');
}
const key = Buffer.from(encryptionKeyHex, 'hex');
const defaults={liaraToken:'',databaseId:'',apiBase:'https://api.liara.ir',sqlHost:'himalayas.liara.cloud',sqlPort:30179,sqlDatabase:'myDB',sqlUser:'',sqlPassword:'',sqlEncrypt:true,sqlTrustCertificate:false,telegramToken:'',telegramChatId:'',telegramEnabled:false,proxyUrl:'socks5h://127.0.0.1:7890',scheduleEnabled:false,cronExpression:'0 3 * * *',timezone:'Asia/Tehran',retention:14,sendOnManual:false};
let cfg={...defaults};let passwordHash=bcrypt.hashSync(adminPassword,12);
function encrypt(obj){const iv=crypto.randomBytes(12);const c=crypto.createCipheriv('aes-256-gcm',key,iv);const payload=Buffer.concat([c.update(JSON.stringify(obj)),c.final()]);return Buffer.concat([iv,c.getAuthTag(),payload]).toString('base64');}
function decrypt(str){const b=Buffer.from(str,'base64');const d=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString());}
if(fs.existsSync(confFile)){const s=decrypt(await fsp.readFile(confFile,'utf8'));cfg={...defaults,...s.cfg};passwordHash=s.passwordHash||passwordHash;}
async function persist(){const tmp=confFile+'.tmp';await fsp.writeFile(tmp,encrypt({cfg,passwordHash}),{mode:0o600});await fsp.rename(tmp,confFile);}
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  frameguard: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameAncestors: ["*"]
    }
  }
}));
app.use(express.json({limit:'32kb'}));
app.use(session({
  name: 'lbm.sid',
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto',
    maxAge: 8 * 3600 * 1000
  }
}));
app.use('/api/login',rateLimit({windowMs:15*60*1000,limit:8,standardHeaders:'draft-7',legacyHeaders:false}));
function auth(req,res,next){if(req.session?.auth)return next();res.status(401).json({error:'ابتدا وارد شوید'});}
function csrf(req,res,next){if(['GET','HEAD','OPTIONS'].includes(req.method))return next();if(req.path==='/login'||req.path==='/api/login')return next();if(!req.session?.auth)return res.status(401).json({error:'ورود لازم است'});if(req.get('x-csrf-token')!==req.session.csrf)return res.status(403).json({error:'CSRF'});next();}
app.use('/api',csrf);
app.post('/api/login',(req,res)=>{if(typeof req.body.password!=='string'||!bcrypt.compareSync(req.body.password,passwordHash))return res.status(401).json({error:'رمز نادرست است'});req.session.regenerate(e=>{if(e)return res.status(500).json({error:'session'});req.session.auth=true;req.session.csrf=crypto.randomBytes(24).toString('hex');res.json({ok:true,csrf:req.session.csrf});});});
app.get('/api/me',auth,(req,res)=>res.json({ok:true,csrf:req.session.csrf}));
app.post('/api/logout',auth,(req,res)=>req.session.destroy(()=>res.json({ok:true})));
const secrets=new Set(['liaraToken','sqlPassword','telegramToken']);
function publicSettings(){const o={...cfg};for(const k of secrets){o[k]='';o[k+'Set']=!!cfg[k];}return o;}
app.get('/api/settings',auth,(req,res)=>res.json(publicSettings()));
function validSettings(n){if(!/^https:\/\/api\.liara\.ir$/.test(n.apiBase))throw Error('آدرس API باید https://api.liara.ir باشد');
 if(n.databaseId&&!/^[a-zA-Z0-9_-]{1,100}$/.test(n.databaseId))throw Error('شناسه دیتابیس نامعتبر');
 if(!cron.validate(n.cronExpression))throw Error('عبارت زمان‌بندی نامعتبر');
 try{new Intl.DateTimeFormat('en',{timeZone:n.timezone});}catch{throw Error('منطقه زمانی نامعتبر');}
 if(!Number.isInteger(n.retention)||n.retention<1||n.retention>1000)throw Error('تعداد نگهداری باید ۱ تا ۱۰۰۰ باشد');
 if(!Number.isInteger(n.sqlPort)||n.sqlPort<1||n.sqlPort>65535)throw Error('پورت نامعتبر');
 if(!/^socks5h?:\/\/127\.0\.0\.1:([0-9]{1,5})$/.test(n.proxyUrl))throw Error('پروکسی فقط socks5h://127.0.0.1:PORT مجاز است');
 if(n.sqlHost&&!/^[a-zA-Z0-9.-]{1,253}$/.test(n.sqlHost))throw Error('SQL hostname نامعتبر');
 if(!/^-?[0-9]{0,20}$/.test(String(n.telegramChatId)))throw Error('Chat ID نامعتبر');
 if(n.telegramToken&&!/^[0-9]{5,}:[a-zA-Z0-9_-]{25,}$/.test(n.telegramToken))throw Error('Bot token نامعتبر');
}
let task=null;function setupSchedule(){if(task){task.stop();task=null;}if(cfg.scheduleEnabled)task=cron.schedule(cfg.cronExpression,()=>{runBackup('scheduled').catch(()=>{});},{timezone:cfg.timezone});}
app.put('/api/settings',auth,async(req,res)=>{try{
 const allowed=Object.keys(defaults);const n={...cfg};for(const k of allowed){if(!Object.hasOwn(req.body,k))continue;const v=req.body[k];if(secrets.has(k)){if(v===null)n[k]='';else if(typeof v==='string'&&v.trim())n[k]=v.trim();continue;}
 if(typeof defaults[k]==='boolean'){if(typeof v!=='boolean')throw Error(k+' باید boolean باشد');n[k]=v;}
 else if(typeof defaults[k]==='number'){n[k]=Number(v);}
 else{if(typeof v!=='string'||v.length>300)throw Error(k+' نامعتبر');n[k]=v.trim();}}
 validSettings(n);cfg=n;await persist();setupSchedule();res.json(publicSettings());
 }catch(e){res.status(400).json({error:e.message});}});
app.post('/api/password',auth,async(req,res)=>{const {currentPassword,newPassword}=req.body;if(!bcrypt.compareSync(currentPassword||'',passwordHash)||typeof newPassword!=='string'||newPassword.length<12)return res.status(400).json({error:'رمز فعلی نامعتبر است یا رمز جدید کمتر از ۱۲ کاراکتر است'});passwordHash=await bcrypt.hash(newPassword,12);await persist();res.json({ok:true});});
function apiConfig(){if(!cfg.liaraToken||!cfg.databaseId)throw Error('توکن و شناسه دیتابیس لیارا را وارد کنید');return {headers:{Authorization:`Bearer ${cfg.liaraToken}`},timeout:30000};}
const apiPath=()=>`${cfg.apiBase}/v1/databases/${encodeURIComponent(cfg.databaseId)}/backups`;
async function listRemote(){const r=await axios.get(apiPath(),apiConfig());const body=r.data;const arr=Array.isArray(body)?body:Array.isArray(body?.backups)?body.backups:Array.isArray(body?.data)?body.data:null;if(!arr)throw Error('ساختار پاسخ لیست بکاپ ناشناخته است؛ مستندات نسخه API را بررسی کنید');return arr.map(x=>({name:String(x.name||x.id||''),lastModified:x.lastModified||x.createdAt||'',size:x.size||0})).filter(x=>x.name);}
async function getBackupLink(name){const u=`${apiPath()}/${encodeURIComponent(name)}/download`;const r=await axios.post(u,{},apiConfig());if(!r.data?.link||typeof r.data.link!=='string')throw Error('لینک دانلود در پاسخ API موجود نیست');return r.data.link;}
function allowedDownload(url){const u=new URL(url);const h=u.hostname.toLowerCase();if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||!['liara.ir','liara.cloud','amazonaws.com'].some(d=>h===d||h.endsWith('.'+d)))throw Error('مقصد دانلود مجاز نیست');return u.toString();}
async function saveRemote(name){const url=allowedDownload(await getBackupLink(name));const file=`backup-${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomBytes(4).toString('hex')}.bak`;const dest=path.join(backupDir,file);let stream;
 try{const response=await axios.get(url,{responseType:'stream',timeout:300000,maxRedirects:0,maxContentLength:2*1024*1024*1024});if(response.status!==200)throw Error('دانلود ناموفق');stream=fs.createWriteStream(dest,{flags:'wx',mode:0o600});let count=0;for await(const chunk of response.data){count+=chunk.length;if(count>2*1024*1024*1024)throw Error('حد فایل ۲ گیگابایت');if(!stream.write(chunk))await new Promise(r=>stream.once('drain',r));}await new Promise((resolve,reject)=>stream.end(e=>e?reject(e):resolve()));return {file,bytes:count};}
 catch(e){stream?.destroy();await fsp.rm(dest,{force:true});throw e;}}
async function sendTelegram(file){if(!cfg.telegramEnabled)return;if(!cfg.telegramToken||!cfg.telegramChatId)throw Error('مشخصات تلگرام تکمیل نیست');const agent=new SocksProxyAgent(cfg.proxyUrl);const form=new FormData();form.append('chat_id',cfg.telegramChatId);form.append('document',fs.createReadStream(path.join(backupDir,file)),{filename:file});await axios.post(`https://api.telegram.org/bot${cfg.telegramToken}/sendDocument`,form,{headers:form.getHeaders(),httpsAgent:agent,proxy:false,timeout:300000,maxBodyLength:Infinity,maxContentLength:Infinity});}
async function localFiles(){const names=(await fsp.readdir(backupDir)).filter(n=>/^backup-[\w.-]+\.bak$/.test(n));const entries=await Promise.all(names.map(async name=>{const s=await fsp.stat(path.join(backupDir,name));return {name,size:s.size,created:s.birthtime.toISOString(),modified:s.mtimeMs};}));return entries.sort((a,b)=>b.modified-a.modified);}
async function retention(){const files=await localFiles();for(const f of files.slice(cfg.retention))await fsp.rm(path.join(backupDir,f.name),{force:true});}
let status={state:'idle',message:'',started:null,ended:null,lastFile:null,origin:null};let running=false;
async function runBackup(origin){if(running)throw Error('بکاپ دیگری در حال اجراست');running=true;status={...status,state:'running',message:'در حال ساخت بکاپ در لیارا',started:new Date().toISOString(),ended:null,origin};
 try{const before=new Set((await listRemote()).map(x=>x.name));await axios.post(apiPath(),{},apiConfig());status.message='در انتظار آماده‌شدن بکاپ';let fresh=null;
 for(let i=0;i<24;i++){await new Promise(r=>setTimeout(r,10000));const list=await listRemote();fresh=list.filter(x=>!before.has(x.name)).sort((a,b)=>String(b.lastModified).localeCompare(String(a.lastModified)))[0];if(fresh)break;}
 if(!fresh)throw Error('بکاپ جدید در زمان تعیین‌شده در فهرست ظاهر نشد؛ ممکن است هنوز پردازش شود');status.message='در حال دانلود';const item=await saveRemote(fresh.name);status.lastFile=item.file;await retention();if(cfg.telegramEnabled&&(origin==='scheduled'||cfg.sendOnManual)){status.message='در حال ارسال تلگرام';await sendTelegram(item.file);}
 status={...status,state:'success',message:'بکاپ ذخیره شد',ended:new Date().toISOString()};return item;
 }catch(e){status={...status,state:'error',message: String(e.response?.data?.message||e.message).slice(0,500),ended:new Date().toISOString()};throw e;}finally{running=false;}}
app.post('/api/backup',auth,(req,res)=>{if(running)return res.status(409).json({error:'بکاپ در حال اجراست'});runBackup('manual').catch(e=>console.error('Backup failed:',e.message));res.status(202).json({ok:true,message:'فرایند بکاپ شروع شد'});});
app.get('/api/status',auth,(req,res)=>res.json(status));
app.get('/api/backups',auth,async(req,res)=>{try{res.json(await localFiles());}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/backups/latest/download',auth,async(req,res)=>{try{const files=await localFiles();if(!files.length)return res.status(404).json({error:'بکاپ محلی موجود نیست'});res.download(path.join(backupDir,files[0].name),files[0].name);}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/backups/:name/download',auth,async(req,res)=>{const name=req.params.name;if(!/^backup-[\w.-]+\.bak$/.test(name))return res.sendStatus(400);const p=path.join(backupDir,name);if(!fs.existsSync(p))return res.sendStatus(404);res.download(p,name);});
app.post('/api/backups/:name/telegram',auth,async(req,res)=>{try{const name=req.params.name;if(!/^backup-[\w.-]+\.bak$/.test(name)||!fs.existsSync(path.join(backupDir,name)))return res.sendStatus(404);await sendTelegram(name);res.json({ok:true});}catch(e){res.status(400).json({error:e.response?.data?.description||e.message});}});
app.delete('/api/backups/:name',auth,async(req,res)=>{try{const name=req.params.name;if(!/^backup-[\w.-]+\.bak$/.test(name))return res.sendStatus(400);const p=path.join(backupDir,name);if(!fs.existsSync(p))return res.sendStatus(404);await fsp.rm(p,{force:true});res.json({ok:true});}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/test-sql',auth,async(req,res)=>{let pool;try{if(!cfg.sqlHost||!cfg.sqlUser||!cfg.sqlPassword)throw Error('تنظیمات SQL تکمیل نیست');pool=await sql.connect({server:cfg.sqlHost,port:cfg.sqlPort,user:cfg.sqlUser,password:cfg.sqlPassword,database:cfg.sqlDatabase,options:{encrypt:cfg.sqlEncrypt,trustServerCertificate:cfg.sqlTrustCertificate},connectionTimeout:15000});const r=await pool.request().query('SELECT DB_NAME() AS db');res.json({ok:true,database:r.recordset[0]?.db});}catch(e){res.status(400).json({error:e.message});}finally{await pool?.close();}});
app.post('/api/test-telegram',auth,async(req,res)=>{try{if(!cfg.telegramEnabled)throw Error('ارسال تلگرام را فعال کنید');const agent=new SocksProxyAgent(cfg.proxyUrl);const r=await axios.post(`https://api.telegram.org/bot${cfg.telegramToken}/sendMessage`,{chat_id:cfg.telegramChatId,text:'اتصال Backup Manager به تلگرام برقرار است.'},{httpsAgent:agent,proxy:false,timeout:30000});res.json({ok:r.data.ok});}catch(e){res.status(400).json({error:e.response?.data?.description||e.message});}});
app.use(express.static(path.join(root,'public')));app.get('*',(req,res)=>res.sendFile(path.join(root,'public','index.html')));
setupSchedule();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => console.log(`Backup Manager ready on http://${HOST}:${PORT}`));
