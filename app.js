(() => {
  'use strict';

  const VERSION = '0.2.0';
  const STORE_KEY = 'karenFuse.v02';
  const RAW_BASE = 'https://raw.githubusercontent.com/mckaren8089-stack/karen-fuse/main/data';
  const nf = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 });
  const pf = new Intl.NumberFormat('fa-IR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dtf = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'short' });

  const $ = id => document.getElementById(id);
  const els = Object.fromEntries([
    'netStatus','dataStatus','goldPrice','goldAge','goldSpread','usdPrice','usdAge','usdSpread','sourceGrid',
    'refreshMarket','marketChart','chartAsset','chartWindow','chartSummary','calRef','calBuy','calSell','fillRef',
    'saveCalibration','calibrationResult','sampleCount','estBluBuy','estBluSell','basisBuyLabel','basisSellLabel',
    'basisChart','manualRef','setManualRef','clearManualRef','referenceMode','tradeCapital','feePct','dropPct',
    'cashAfterSell','costToRebuy','netTradeProfit','netTradePct','historyBody','exportJson','importJson','clearData'
  ].map(id => [id, $(id)]));

  const defaults = {
    version: VERSION,
    calibrations: [],
    manualReference: null,
    settings: { tradeCapital: 15000000, feePct: 0.5, dropPct: 2 },
    lastMarket: null,
    marketHistory: []
  };

  let state = load();
  let latest = null;
  let history = [];

  function clone(v){ return JSON.parse(JSON.stringify(v)); }
  function merge(target, src){
    if(!src || typeof src !== 'object') return target;
    for(const k of Object.keys(src)){
      if(src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) merge(target[k], src[k]);
      else target[k] = src[k];
    }
    return target;
  }
  function load(){
    try { return merge(clone(defaults), JSON.parse(localStorage.getItem(STORE_KEY) || 'null') || {}); }
    catch { return clone(defaults); }
  }
  function save(){ localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  function num(v){
    if(v == null) return NaN;
    return Number(String(v).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٬,\s]/g,'').replace('٫','.'));
  }
  function money(v){ return Number.isFinite(Number(v)) ? nf.format(Math.round(Number(v))) : '—'; }
  function pct(v){ return Number.isFinite(Number(v)) ? pf.format(Number(v)) + '٪' : '—'; }
  function age(ts){
    if(!ts) return '—';
    const ms = Date.now() - new Date(ts).getTime();
    if(!Number.isFinite(ms)) return '—';
    const sec = Math.max(0, Math.round(ms/1000));
    if(sec < 60) return `${nf.format(sec)} ثانیه پیش`;
    if(sec < 3600) return `${nf.format(Math.round(sec/60))} دقیقه پیش`;
    if(sec < 86400) return `${nf.format(Math.round(sec/3600))} ساعت پیش`;
    return `${nf.format(Math.round(sec/86400))} روز پیش`;
  }
  function refPrice(){
    if(Number.isFinite(Number(state.manualReference)) && Number(state.manualReference) > 0) return Number(state.manualReference);
    return Number(latest?.consensus?.gold18_toman || state.lastMarket?.consensus?.gold18_toman || 0) || null;
  }

  function basisModel(){
    const arr = state.calibrations.slice(-20);
    if(!arr.length) return { buy:0, sell:0, count:0 };
    let wb=0, ws=0, sum=0;
    arr.forEach((r,i)=>{ const w=Math.pow(i+1,1.35); wb+=r.basisBuy*w; ws+=r.basisSell*w; sum+=w; });
    return { buy:wb/sum, sell:ws/sum, count:arr.length };
  }

  function estimates(){
    const ref = refPrice();
    const b = basisModel();
    if(!ref) return {ref:null,b,buy:null,sell:null};
    return {ref,b,buy:ref*(1+b.buy/100),sell:ref*(1+b.sell/100)};
  }

  function tradeCalc(){
    const e=estimates();
    const capital=num(els.tradeCapital.value), fee=num(els.feePct.value)/100, drop=num(els.dropPct.value)/100;
    if(!e.buy || !e.sell || !(capital>0) || !Number.isFinite(fee) || !Number.isFinite(drop)) return null;
    const grams=capital/e.sell;
    const cashAfterSell=capital*(1-fee);
    const futureBuy=e.buy*(1-drop);
    const costToRebuy=grams*futureBuy*(1+fee);
    const profit=cashAfterSell-costToRebuy;
    return {cashAfterSell,costToRebuy,profit,profitPct:profit/capital*100};
  }

  async function fetchJson(url){
    const sep=url.includes('?')?'&':'?';
    const r=await fetch(`${url}${sep}t=${Date.now()}`,{cache:'no-store'});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  async function refreshMarket(){
    els.dataStatus.textContent='داده: در حال دریافت…';
    try{
      const [l,h]=await Promise.all([
        fetchJson(`${RAW_BASE}/latest.json`),
        fetchJson(`${RAW_BASE}/history.json`)
      ]);
      latest=l; history=Array.isArray(h?.points)?h.points:[];
      state.lastMarket=l; state.marketHistory=history.slice(-3000); save();
      els.dataStatus.textContent=`داده: ${age(l.generated_at)}`;
      els.dataStatus.className='pill';
      renderMarket(); render(); drawMarketChart();
    }catch(err){
      latest=state.lastMarket;
      history=Array.isArray(state.marketHistory)?state.marketHistory:[];
      els.dataStatus.textContent='داده: ذخیرهٔ محلی';
      els.dataStatus.className='pill muted';
      renderMarket(); render(); drawMarketChart();
      console.warn(err);
    }
  }

  function renderMarket(){
    const m=latest || state.lastMarket;
    const gold=Number(m?.consensus?.gold18_toman), usd=Number(m?.consensus?.usd_toman);
    els.goldPrice.textContent=gold>0?money(gold):'—';
    els.usdPrice.textContent=usd>0?money(usd):'—';
    els.goldAge.textContent=age(m?.generated_at);
    els.usdAge.textContent=age(m?.generated_at);
    els.goldSpread.textContent=`اختلاف منابع: ${pct(m?.spread?.gold_pct)}`;
    els.usdSpread.textContent=`اختلاف منابع: ${pct(m?.spread?.usd_pct)}`;
    if(Number(m?.spread?.gold_pct)>1) els.goldSpread.className='warn-text'; else els.goldSpread.className='';
    if(Number(m?.spread?.usd_pct)>1) els.usdSpread.className='warn-text'; else els.usdSpread.className='';

    const sources=m?.sources || {};
    const labels={tgju:'TGJU',estjt:'اتحادیه طلا تهران',pashizi:'پشیزی',zarscan:'زر اسکن',geram18:'گرم ۱۸',navasan_widget:'نوسان'};
    const preferred=['tgju','estjt','pashizi','zarscan','geram18','navasan_widget'];
    const order=[...preferred,...Object.keys(sources).filter(k=>!preferred.includes(k))];
    els.sourceGrid.innerHTML=order.filter(k=>sources[k]).map(k=>{
      const s=sources[k]||{};
      const ok=!!s.ok;
      const cls=ok?'':'bad';
      const note=ok ? `به‌روز: ${age(s.updated_at || m?.generated_at)}` : `خطا: ${escapeHtml(s.error || 'نامشخص')}`;
      return `<article class="source-card ${cls}"><div class="name">${escapeHtml(labels[k]||k)}</div><div class="state">${note}</div><div class="values"><div><span>طلا ۱۸</span><strong>${money(s.gold18_toman)}</strong></div><div><span>دلار</span><strong>${money(s.usd_toman)}</strong></div></div></article>`;
    }).join('') || '<div class="tiny">هنوز داده‌ای جمع‌آوری نشده است.</div>';
  }

  function escapeHtml(s){ return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

  function render(){
    const e=estimates();
    const b=e.b;
    els.sampleCount.textContent=`${nf.format(state.calibrations.length)} نمونه`;
    els.estBluBuy.textContent=e.buy?money(e.buy):'—';
    els.estBluSell.textContent=e.sell?money(e.sell):'—';
    els.basisBuyLabel.textContent=pct(b.buy);
    els.basisSellLabel.textContent=pct(b.sell);
    els.referenceMode.textContent=state.manualReference ? `مرجع محاسبات: دستی — ${money(state.manualReference)} تومان` : `مرجع محاسبات: اجماع بازار — ${money(e.ref)} تومان`;

    const c=tradeCalc();
    els.cashAfterSell.textContent=c?money(c.cashAfterSell)+' تومان':'—';
    els.costToRebuy.textContent=c?money(c.costToRebuy)+' تومان':'—';
    els.netTradeProfit.textContent=c?money(c.profit)+' تومان':'—';
    els.netTradePct.textContent=c?pct(c.profitPct):'—';
    els.netTradeProfit.className=c?(c.profit>=0?'pos':'neg'):'';
    els.netTradePct.className=c?(c.profitPct>=0?'pos':'neg'):'';
    renderBluHistory(); drawBasisChart();
  }

  function renderBluHistory(){
    const rows=state.calibrations.slice().reverse().slice(0,30);
    if(!rows.length){els.historyBody.innerHTML='<tr><td colspan="6" class="empty">هنوز نمونه‌ای ثبت نشده است.</td></tr>';return;}
    els.historyBody.innerHTML=rows.map(r=>`<tr><td>${dtf.format(new Date(r.at))}</td><td>${money(r.ref)}</td><td>${money(r.buy)}</td><td>${money(r.sell)}</td><td>${pct(r.basisBuy)}</td><td>${pct(r.basisSell)}</td></tr>`).join('');
  }

  function prepareCanvas(canvas){
    const dpr=Math.max(1,window.devicePixelRatio||1); const rect=canvas.getBoundingClientRect();
    canvas.width=Math.max(1,Math.floor(rect.width*dpr)); canvas.height=Math.max(1,Math.floor(rect.height*dpr));
    const ctx=canvas.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0); return {ctx,W:rect.width,H:rect.height};
  }

  function drawBasisChart(){
    const {ctx,W,H}=prepareCanvas(els.basisChart); ctx.clearRect(0,0,W,H);
    const arr=state.calibrations.slice(-30);
    if(arr.length<2){ctx.fillStyle='#8294a8';ctx.font='12px Tahoma';ctx.textAlign='center';ctx.fillText('با ثبت چند نمونه، روند اختلاف بلو اینجا دیده می‌شود.',W/2,H/2);return;}
    const vals=arr.flatMap(r=>[r.basisBuy,r.basisSell]); let min=Math.min(...vals),max=Math.max(...vals); if(min===max){min-=.25;max+=.25}
    const pad=24, x=i=>pad+i*(W-pad*2)/(arr.length-1), y=v=>H-pad-(v-min)*(H-pad*2)/(max-min);
    ctx.strokeStyle='#294158';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(pad,y(0));ctx.lineTo(W-pad,y(0));ctx.stroke();
    [[r=>r.basisBuy,'#f2c14e'],[r=>r.basisSell,'#3bd79f']].forEach(([get,color])=>{ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();arr.forEach((r,i)=>i?ctx.lineTo(x(i),y(get(r))):ctx.moveTo(x(i),y(get(r))));ctx.stroke();});
  }

  function drawMarketChart(){
    const {ctx,W,H}=prepareCanvas(els.marketChart); ctx.clearRect(0,0,W,H);
    const asset=els.chartAsset.value, hours=Number(els.chartWindow.value)||168, cutoff=Date.now()-hours*3600e3;
    const arr=history.filter(p=>new Date(p.ts).getTime()>=cutoff).map(p=>({ts:new Date(p.ts).getTime(),v:Number(asset==='gold'?p.gold18_toman:p.usd_toman)})).filter(p=>p.ts&&p.v>0);
    if(arr.length<2){ctx.fillStyle='#8294a8';ctx.font='12px Tahoma';ctx.textAlign='center';ctx.fillText('هنوز دادهٔ تاریخی کافی جمع نشده است.',W/2,H/2);els.chartSummary.textContent='—';return;}
    const vals=arr.map(p=>p.v), min0=Math.min(...vals), max0=Math.max(...vals), span=Math.max(1,max0-min0), min=min0-span*.08, max=max0+span*.08;
    const padL=12,padR=12,padT=18,padB=28; const x=t=>padL+(t-arr[0].ts)*(W-padL-padR)/(arr[arr.length-1].ts-arr[0].ts||1); const y=v=>H-padB-(v-min)*(H-padT-padB)/(max-min||1);
    ctx.strokeStyle='#294158';ctx.lineWidth=1; for(let i=0;i<4;i++){const yy=padT+i*(H-padT-padB)/3;ctx.beginPath();ctx.moveTo(padL,yy);ctx.lineTo(W-padR,yy);ctx.stroke();}
    ctx.strokeStyle=asset==='gold'?'#f2c14e':'#68adff';ctx.lineWidth=2.2;ctx.beginPath();arr.forEach((p,i)=>i?ctx.lineTo(x(p.ts),y(p.v)):ctx.moveTo(x(p.ts),y(p.v)));ctx.stroke();
    ctx.fillStyle='#8294a8';ctx.font='11px Tahoma';ctx.textAlign='right';ctx.fillText(money(max0),W-padR,padT+2);ctx.fillText(money(min0),W-padR,H-padB-4);
    const first=arr[0].v,last=arr[arr.length-1].v,change=(last/first-1)*100;
    els.chartSummary.innerHTML=`<span>اول: ${money(first)}</span><span>آخر: ${money(last)}</span><span class="${change>=0?'pos':'neg'}">تغییر: ${pct(change)}</span><span>نقطه: ${nf.format(arr.length)}</span>`;
  }

  els.refreshMarket.addEventListener('click',refreshMarket);
  els.chartAsset.addEventListener('change',drawMarketChart);
  els.chartWindow.addEventListener('change',drawMarketChart);
  window.addEventListener('resize',()=>{drawMarketChart();drawBasisChart();});

  els.fillRef.addEventListener('click',()=>{const r=refPrice();if(r)els.calRef.value=Math.round(r);});
  els.saveCalibration.addEventListener('click',()=>{
    const ref=num(els.calRef.value),buy=num(els.calBuy.value),sell=num(els.calSell.value);
    if(!(ref>0&&buy>0&&sell>0)){els.calibrationResult.textContent='هر سه عدد مرجع، خرید بلو و فروش بلو را وارد کن.';return;}
    const row={at:Date.now(),ref,buy,sell,basisBuy:(buy/ref-1)*100,basisSell:(sell/ref-1)*100};
    state.calibrations.push(row); if(state.calibrations.length>1000)state.calibrations=state.calibrations.slice(-1000); save();
    els.calibrationResult.textContent=`ثبت شد — اختلاف خرید ${pct(row.basisBuy)} | اختلاف فروش ${pct(row.basisSell)}`;
    els.calBuy.value='';els.calSell.value=''; render();
  });

  els.setManualRef.addEventListener('click',()=>{const v=num(els.manualRef.value);if(v>0){state.manualReference=Math.round(v);save();render();}});
  els.clearManualRef.addEventListener('click',()=>{state.manualReference=null;els.manualRef.value='';save();render();});
  ['tradeCapital','feePct','dropPct'].forEach(id=>els[id].addEventListener('input',()=>{
    if(id==='tradeCapital')state.settings.tradeCapital=num(els.tradeCapital.value)||0;
    if(id==='feePct')state.settings.feePct=num(els.feePct.value)||0;
    if(id==='dropPct')state.settings.dropPct=num(els.dropPct.value)||0;
    save();render();
  }));

  function download(name,text,type){const b=new Blob([text],{type});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
  els.exportJson.addEventListener('click',()=>download(`karen-fuse-blu-${Date.now()}.json`,JSON.stringify({version:VERSION,calibrations:state.calibrations},null,2),'application/json'));
  els.importJson.addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;try{const j=JSON.parse(await f.text());if(!Array.isArray(j.calibrations))throw new Error('bad');state.calibrations=j.calibrations.slice(-1000);save();render();}catch{alert('فایل معتبر نیست.')}});
  els.clearData.addEventListener('click',()=>{if(confirm('نمونه‌های بلو پاک شوند؟')){state.calibrations=[];save();render();}});

  function updateNet(){els.netStatus.textContent=navigator.onLine?'آنلاین':'آفلاین';els.netStatus.className=navigator.onLine?'pill':'pill muted';}
  window.addEventListener('online',()=>{updateNet();refreshMarket();});window.addEventListener('offline',updateNet);

  function hydrate(){
    els.tradeCapital.value=String(state.settings.tradeCapital||15000000);
    els.feePct.value=String(state.settings.feePct??0.5);
    els.dropPct.value=String(state.settings.dropPct??2);
    if(state.manualReference)els.manualRef.value=String(state.manualReference);
  }

  hydrate();updateNet();renderMarket();render();refreshMarket();
  setInterval(refreshMarket,60_000);
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
})();
