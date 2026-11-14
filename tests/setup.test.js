const { chromium } = require("playwright");
const http=require("http"),os=require("os"),fs=require("fs"),path=require("path");
const EXT = require("path").resolve(process.argv[2] || require("path").join(__dirname, "..", "extension")); let models=[]; const origins=[];
const srv=http.createServer((req,res)=>{let b="";req.on("data",c=>b+=c);req.on("end",async()=>{
  origins.push(req.headers.origin||null);
  if(req.url==="/api/version") return res.end('{"version":"0.33.0"}');
  if(req.url==="/api/tags") return res.end(JSON.stringify({models:models.map(n=>({name:n}))}));
  if(req.url==="/api/pull"){ const m=JSON.parse(b).model; res.write('{"status":"pulling manifest"}\n');
    for(const c of [0,1e9,2e9,3.3e9]){ await new Promise(r=>setTimeout(r,150)); res.write(JSON.stringify({status:"downloading",digest:"sha256:a",total:3.3e9,completed:c})+"\n"); }
    res.write('{"status":"verifying sha256 digest"}\n{"status":"success"}\n'); models.push(m); return res.end(); }
  if(req.url==="/api/chat"){ const j=JSON.parse(b); const src=j.messages[0].content.split("\n\n\n")[1].split("\n");
    return res.end(JSON.stringify({message:{content:src.map(l=>"PL "+l).join("\n")}})); }
  res.statusCode=404;res.end();});});
(async()=>{
  const ctx=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),"pw-")),{channel:"chromium",headless:true,args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
  // wizard should open by itself on install
  let page = ctx.pages().find(p=>p.url().includes("setup.html")) || await ctx.waitForEvent("page",{predicate:p=>p.url().includes("setup.html"),timeout:10000});
  const errs=[]; page.on("pageerror",e=>errs.push(e.message));
  await page.waitForSelector("#s1-install:not(.hidden)",{timeout:10000});
  console.log("install step shown, linux box visible:", await page.isVisible("#s1-linux"));
  // "user installs Ollama" → wizard should detect it
  await new Promise(r=>srv.listen(11434,"127.0.0.1",r));
  await page.waitForSelector("#s2-body:not(.hidden)",{timeout:10000});
  console.log("detected:", await page.textContent("#s1-ver"));
  await page.click("#pull");
  await page.waitForFunction(()=>/Test (translation|tłumaczenia)/.test(document.getElementById("s3-test").textContent),null,{timeout:15000});
  console.log("final:", await page.textContent("#s3-test"));
  const st = await page.evaluate(()=>chrome.storage.local.get("settings"));
  console.log("saved model:", st.settings.model, "| origin headers seen:", [...new Set(origins)]);
  console.log(errs.length?"ERRORS "+errs:"SETUP OK"); await ctx.close(); srv.close();
})().catch(e=>{console.error("FAIL",e.message);process.exit(1)});
