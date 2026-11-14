const { chromium } = require("playwright");
const http = require("http"); const os=require("os"); const fs=require("fs"); const path=require("path");
const EXT = require("path").resolve(process.argv[2] || require("path").join(__dirname, "..", "extension"));
const srv = http.createServer((req,res)=>{let b="";req.on("data",c=>b+=c);req.on("end",()=>{
  if(req.url==="/api/version") return res.end("{\"version\":\"x\"}");
  if(req.url==="/api/tags") return res.end(JSON.stringify({models:[{name:"translategemma:4b"},{name:"gemma3:4b"}]}));
  const j=JSON.parse(b); const src=j.messages[0].content.split("\n\n\n")[1].split("\n");
  res.end(JSON.stringify({message:{content:src.map(l=>"PL "+l).join("\n")}}));});});
(async()=>{
  await new Promise(r=>srv.listen(11434,"127.0.0.1",r));
  const ctx=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),"pw-")),{channel:"chromium",headless:true,locale:"pl-PL",args:["--lang=pl",`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
  let [sw]=ctx.serviceWorkers(); if(!sw) sw=await ctx.waitForEvent("serviceworker");
  const id=sw.url().split("/")[2];
  const p=await ctx.newPage(); const errs=[]; p.on("pageerror",e=>errs.push(e.message));
  await p.goto(`chrome-extension://${id}/popup.html`);
  await p.waitForFunction(()=>[...document.querySelectorAll("#modelSelect option")].some(o=>o.value==="gemma3:4b"));
  await p.click("#test");
  await p.waitForFunction(()=>/PL So the first/.test(document.getElementById("testOut").textContent),null,{timeout:10000});
  await p.setViewportSize({width:320,height:640}); await p.screenshot({path:require("path").join(require("os").tmpdir(),"privatesubs-popup.png"),fullPage:true}); console.log(await p.evaluate(()=>[...document.querySelectorAll("#targetLang option")].slice(0,4).map(o=>o.text).join(" | "))); console.log("status:",await p.textContent("#status"));
  console.log(errs.length?"ERRORS "+errs:"POPUP OK"); await ctx.close(); srv.close();
})().catch(e=>{console.error("FAIL",e.message);process.exit(1)});
