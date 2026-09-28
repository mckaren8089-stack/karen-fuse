(() => {
  'use strict';

  const VERSION = '0.3.0';
  const STORE_KEY = 'karenFuse.v03';
  const LEGACY_KEYS = ['karenFuse.v02'];
  const RAW_BASE = 'https://raw.githubusercontent.com/mckaren8089-stack/karen-fuse/main/data';
  const EXPECTED_DATA_SECONDS = 300;
  const POLL_MS = 20_000;

  const nf = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 });
  const pf = new Intl.NumberFormat('fa-IR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dtf = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'short' });

  const $ = id => document.getElementById(id);
  const ids = [
    'netStatus','dataAge','goldPrice','goldMove','goldSpread','goldMin','goldMax','goldSpark',
    'usdPrice','usdMove','usdBuy','usdSell','usdSourceNote','fuseRing','fuseMinutes','fuseState','fuseDetail',
    'refreshMarket','sourceGrid','sourceFooter','chartTitle','marketChart','chartEmpty','rangeChange','rangeLow',
    'rangeHigh','rangeCoverage','sampleCount','bluReferenceDisplay','referenceMode','calRef','calBuy','calSell',
    'saveCalibration','calibrationResult','estBluBuy','estBluSell','basisBuyLabel','basisSellLabel','basisChart',
    'manualRef','setManualRef','clearManualRef','tradeCapital','feePct','dropPct','cashAfterSell','costToRebuy',
    'netTradeProfit','netTradePct','historyList','exportJson','importJson','clearData'
  ];
  const els = Object.fromEntries(ids.map(id => [id, $(id)]));

  const defaults = {
    version: VERSION,
    calibrations: [],
    manualReference: null,
    settings: { tradeCapital: 15000000, feePct: 0.5, dropPct: 2 },
    lastMarket: null,
    marketHistory: []
  };

  let state = load();
  let latest = state.lastMarket || null;
  let history = Array.isArray(state.marketHistory) ? state.marketHistory : [];
  let chartAsset = 'gold';
  let chartHours = 1;
  let calRefTouched = false;
  let refreshBusy = false;

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
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch {}
    if(!raw){
      for(const key of LEGACY_KEYS){
        try {
          const legacy = JSON.parse(localStorage.getItem(key) || 'null');
          if(legacy){ raw = legacy; break; }
        } catch {}
      }
    }
    const s = merge(clone(defaults), raw || {});
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch {}
    return s;
  }
  function save(){ try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {} }

  function num(v){
    if(v == null) return NaN;
    return Number(String(v).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٬,\s]/g,'').replace('٫','.'));
  }
  function money(v){ return Number.isFinite(Number(v)) && Number(v)>0 ? nf.format(Math.round(Number(v))) : '—'; }
  function pct(v){ return Number.isFinite(Number(v)) ? pf.format(Number(v)) + '٪' : '—'; }
  function ageSeconds(ts){
    const t = new Date(ts || 0).getTime();
    if(!Number.isFinite(t) || !t) return Infinity;
    return Math.max(0,(Date.now()-t)/1000);
  }
  function ageLabel(ts){
    const s=ageSeconds(ts);
    if(!Number.isFinite(s)) return '—';
    if(s<60) return `${nf.format(Math.round(s))} ثانیه`;
    if(s<3600) return `${nf.format(Math.round(s/60))} دقیقه`;
    return `${nf.format(Math.round(s/3600))} ساعت`;
  }
  function signedPct(v){
    if(!Number.isFinite(v)) return '—';
    const sign=v>0?'+':'';
    return sign + pf.format(v) + '٪';
  }
  function escapeHtml(s){ return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

  function refPrice(){
    if(Number(state.manualReference)>0) return Number(state.manualReference);
    return Number(latest?.consensus?.gold18_toman || 0) || null;
  }

  function basisModel(){
    const arr=state.calibrations.slice(-20);
    if(!arr.length) return {buy:0,sell:0,count:0};
    let wb=0,ws=0,sum=0;
    arr.forEach((r,i)=>{ const w=Math.pow(i+1,1.35); wb+=Number(r.basisBuy||0)*w; ws+=Number(r.basisSell||0)*w; sum+=w; });
    return {buy:wb/sum,sell:ws/sum,count:arr.length};
  }

  function estimates(){
    const ref=refPrice(), b=basisModel();
    if(!ref) return {ref:null,b,buy:null,sell:null};
    return {ref,b,buy:ref*(1+b.buy/100),sell:ref*(1+b.sell/100)};
  }

  function tradeCalc(){
    const e=estimates(), capital=num(els.tradeCapital.value), fee=num(els.feePct.value)/100, drop=num(els.dropPct.value)/100;
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
    if(refreshBusy) return;
    refreshBusy=true;
    if(els.refreshMarket) els.refreshMarket.textContent='…';
    try{
      const [l,h]=await Promise.all([fetchJson(`${RAW_BASE}/latest.json`),fetchJson(`${RAW_BASE}/history.json`)]);
      latest=l;
      history=Array.isArray(h?.points)?h.points:[];
      state.lastMarket=l;
      state.marketHistory=history.slice(-5000);
      save();
    }catch(err){
      latest=state.lastMarket;
      history=Array.isArray(state.marketHistory)?state.marketHistory:[];
      console.warn('market refresh failed',err);
    }finally{
      refreshBusy=false;
      if(els.refreshMarket) els.refreshMarket.textContent='↻';
      renderAll();
    }
  }

  function sourceNumbers(asset){
    const values=[];
    Object.values(latest?.sources||{}).forEach(s=>{
      if(!s?.ok) return;
      const v=Number(asset==='gold'?s.gold18_toman:s.usd_toman);
      if(v>0) values.push(v);
    });
    return values;
  }

  function pointValue(p,asset){ return Number(asset==='gold'?p.gold18_toman:p.usd_toman); }
  function recentPoints(asset,hours=1){
    const cutoff=Date.now()-hours*3600e3;
    return history
      .map(p=>({ts:new Date(p.ts).getTime(),v:pointValue(p,asset)}))
      .filter(p=>p.ts>=cutoff && p.v>0)
      .sort((a,b)=>a.ts-b.ts);
  }
  function moveFromHistory(asset){
    const arr=recentPoints(asset,1);
    if(arr.length<2) return NaN;
    const prev=arr[arr.length-2].v, last=arr[arr.length-1].v;
    return prev?((last/prev)-1)*100:NaN;
  }

  function renderOverview(){
    const gold=Number(latest?.consensus?.gold18_toman), usd=Number(latest?.consensus?.usd_toman);
    els.goldPrice.textContent=money(gold);
    els.usdPrice.textContent=money(usd);

    const gm=moveFromHistory('gold'), um=moveFromHistory('usd');
    setMove(els.goldMove,gm); setMove(els.usdMove,um);

    const gvals=sourceNumbers('gold');
    els.goldSpread.textContent=pct(latest?.spread?.gold_pct);
    els.goldMin.textContent=gvals.length?money(Math.min(...gvals)):'—';
    els.goldMax.textContent=gvals.length?money(Math.max(...gvals)):'—';

    const alan=latest?.sources?.alanchand || {};
    els.usdBuy.textContent=money(alan.usd_buy_toman);
    els.usdSell.textContent=money(alan.usd_sell_toman);
    els.usdSourceNote.textContent=alan.ok ? 'خرید/فروش: الان چند • عدد بزرگ: اجماع منابع' : 'عدد بزرگ: اجماع منابع';

    const ts=latest?.generated_at;
    els.dataAge.textContent=`${ageLabel(ts)} پیش`;
    updateFuse(ts);
    drawSpark(els.goldSpark,recentPoints('gold',1),'gold');
  }

  function setMove(el,v){
    el.className='move-badge ' + (!Number.isFinite(v)?'neutral':v>0?'pos':v<0?'neg':'neutral');
    el.textContent=Number.isFinite(v)?signedPct(v):'بدون تغییر';
  }

  function updateFuse(ts){
    const sec=ageSeconds(ts);
    const freshness=Math.max(0,Math.min(100,100-sec/EXPECTED_DATA_SECONDS*100));
    els.fuseRing.style.setProperty('--fresh',freshness+'%');
    els.fuseMinutes.textContent=sec<60?'<۱د':`${nf.format(Math.round(sec/60))}د`;
    if(sec<=360){
      els.fuseState.textContent='بازار تازه';
      els.fuseState.className='pos';
      els.fuseDetail.textContent='داده در چرخهٔ پنج‌دقیقه‌ای است';
    }else if(sec<=900){
      els.fuseState.textContent='کمی تأخیر';
      els.fuseState.className='warn';
      els.fuseDetail.textContent='اجرای بعدی گیت‌هاب در انتظار است';
    }else{
      els.fuseState.textContent='داده کهنه';
      els.fuseState.className='neg';
      els.fuseDetail.textContent='منابع یا جمع‌آورنده را بررسی کن';
    }
  }

  function renderSources(){
    const labels={alanchand:'الان چند',tgju:'TGJU',estjt:'اتحادیه تهران',pashizi:'پشیزی',zarscan:'زر اسکن',geram18:'گرم ۱۸',navasan_widget:'نوسان'};
    const preferred=['alanchand','tgju','estjt','navasan_widget','pashizi','zarscan','geram18'];
    const sources=latest?.sources||{};
    const active=preferred.filter(k=>sources[k]?.ok);
    const failed=preferred.filter(k=>sources[k] && !sources[k].ok);

    els.sourceGrid.innerHTML=active.map(k=>{
      const s=sources[k];
      const usdDisplay=s.usd_sell_toman || s.usd_toman;
      return `<article class="source-tile">
        <div class="source-name"><strong>${escapeHtml(labels[k]||k)}</strong><i class="live-dot"></i></div>
        <div class="source-values">
          <div><span>طلا ۱۸</span><b>${money(s.gold18_toman)}</b></div>
          <div><span>${s.usd_sell_toman?'دلار فروش':'دلار'}</span><b>${money(usdDisplay)}</b></div>
        </div>
      </article>`;
    }).join('') || '<div class="source-footer">هیچ منبع سالمی در این نوبت در دسترس نیست.</div>';

    const goldCount=Object.values(sources).filter(s=>s?.ok && Number(s.gold18_toman)>0).length;
    const usdCount=Object.values(sources).filter(s=>s?.ok && Number(s.usd_toman)>0).length;
    const failedNames=failed.map(k=>labels[k]||k);
    els.sourceFooter.textContent=`مرجع طلا از ${nf.format(goldCount)} منبع و دلار از ${nf.format(usdCount)} منبع ساخته شده` +
      (failedNames.length?` • خارج از اجماع: ${failedNames.join('، ')}`:'');
  }

  function historyCoverageHours(){
    if(history.length<2) return 0;
    const a=new Date(history[0].ts).getTime(), b=new Date(history[history.length-1].ts).getTime();
    return Math.max(0,(b-a)/3600e3);
  }

  function updateRangeButtons(){
    const coverage=historyCoverageHours();
    document.querySelectorAll('.range-btn').forEach(btn=>{
      const h=Number(btn.dataset.hours);
      const enough = h===1 ? history.length>=2 : coverage >= Math.min(h*.72,h-0.25);
      btn.disabled=!enough;
      btn.title=enough?'':`هنوز ${nf.format(Math.max(1,Math.ceil(h-coverage)))} ساعت داده کم است`;
      if(btn.classList.contains('active') && !enough){
        btn.classList.remove('active');
        const first=document.querySelector('.range-btn:not(:disabled)');
        if(first){first.classList.add('active');chartHours=Number(first.dataset.hours);}
      }
    });
  }

  function drawMarketChart(){
    updateRangeButtons();
    const arr=recentPoints(chartAsset,chartHours);
    const canvas=els.marketChart;
    const {ctx,W,H}=prepareCanvas(canvas);
    ctx.clearRect(0,0,W,H);
    els.chartEmpty.hidden=arr.length>=2;

    els.chartTitle.textContent=chartAsset==='gold'?'طلای ۱۸ عیار':'دلار آزاد';
    if(arr.length<2){
      els.rangeChange.textContent='—'; els.rangeLow.textContent='—'; els.rangeHigh.textContent='—';
      els.rangeCoverage.textContent=history.length?formatCoverage(historyCoverageHours()):'۰ دقیقه';
      return;
    }

    const vals=arr.map(p=>p.v), min0=Math.min(...vals), max0=Math.max(...vals);
    const span=Math.max(1,max0-min0), min=min0-span*.18, max=max0+span*.18;
    const pad={l:10,r:10,t:20,b:28};
    const x=t=>pad.l+(t-arr[0].ts)*(W-pad.l-pad.r)/(arr[arr.length-1].ts-arr[0].ts||1);
    const y=v=>H-pad.b-(v-min)*(H-pad.t-pad.b)/(max-min||1);

    ctx.strokeStyle='rgba(119,151,181,.18)';ctx.lineWidth=1;
    for(let i=0;i<4;i++){const yy=pad.t+i*(H-pad.t-pad.b)/3;ctx.beginPath();ctx.moveTo(pad.l,yy);ctx.lineTo(W-pad.r,yy);ctx.stroke();}

    const color=chartAsset==='gold'?'#f6c453':'#6bb6ff';
    const grad=ctx.createLinearGradient(0,pad.t,0,H-pad.b);
    grad.addColorStop(0,chartAsset==='gold'?'rgba(246,196,83,.22)':'rgba(107,182,255,.22)');
    grad.addColorStop(1,'rgba(0,0,0,0)');

    ctx.beginPath();
    arr.forEach((p,i)=>i?ctx.lineTo(x(p.ts),y(p.v)):ctx.moveTo(x(p.ts),y(p.v)));
    ctx.lineTo(x(arr[arr.length-1].ts),H-pad.b);ctx.lineTo(x(arr[0].ts),H-pad.b);ctx.closePath();
    ctx.fillStyle=grad;ctx.fill();

    ctx.beginPath();
    arr.forEach((p,i)=>i?ctx.lineTo(x(p.ts),y(p.v)):ctx.moveTo(x(p.ts),y(p.v)));
    ctx.strokeStyle=color;ctx.lineWidth=2.4;ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke();

    const last=arr[arr.length-1];
    ctx.beginPath();ctx.arc(x(last.ts),y(last.v),4,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();

    ctx.fillStyle='rgba(190,207,223,.7)';ctx.font='10px Tahoma';ctx.textAlign='left';
    ctx.fillText(money(max0),pad.l+2,pad.t+2);
    ctx.fillText(money(min0),pad.l+2,H-pad.b-5);

    const change=(arr[arr.length-1].v/arr[0].v-1)*100;
    els.rangeChange.textContent=signedPct(change);
    els.rangeChange.className=change>0?'pos':change<0?'neg':'';
    els.rangeLow.textContent=money(min0);
    els.rangeHigh.textContent=money(max0);
    els.rangeCoverage.textContent=formatCoverage((arr[arr.length-1].ts-arr[0].ts)/3600e3);
  }

  function formatCoverage(h){
    if(h<1) return `${nf.format(Math.max(1,Math.round(h*60)))} دقیقه`;
    if(h<24) return `${nf.format(Math.round(h*10)/10)} ساعت`;
    return `${nf.format(Math.round(h/24*10)/10)} روز`;
  }

  function prepareCanvas(canvas){
    const dpr=Math.max(1,Math.min(2,window.devicePixelRatio||1));
    const rect=canvas.getBoundingClientRect();
    canvas.width=Math.max(1,Math.floor(rect.width*dpr)); canvas.height=Math.max(1,Math.floor(rect.height*dpr));
    const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
    return {ctx,W:rect.width,H:rect.height};
  }

  function drawSpark(canvas,arr,asset){
    const {ctx,W,H}=prepareCanvas(canvas);ctx.clearRect(0,0,W,H);
    if(arr.length<2) return;
    const vals=arr.map(p=>p.v),mn=Math.min(...vals),mx=Math.max(...vals),span=Math.max(1,mx-mn);
    const x=i=>i*(W/(arr.length-1)), y=v=>H-6-(v-(mn-span*.1))*(H-12)/(span*1.2);
    const color=asset==='gold'?'#f6c453':'#6bb6ff';
    ctx.beginPath();arr.forEach((p,i)=>i?ctx.lineTo(x(i),y(p.v)):ctx.moveTo(x(i),y(p.v)));
    ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();
  }

  function autoFillCalibrationReference(){
    const r=refPrice();
    els.bluReferenceDisplay.textContent=r?money(r)+' تومان':'—';
    els.referenceMode.textContent=state.manualReference?'دستی':'اجماع';
    if(r && (!calRefTouched || !num(els.calRef.value))) els.calRef.value=Math.round(r);
  }

  function renderBlu(){
    const e=estimates(), b=e.b;
    els.sampleCount.textContent=`${nf.format(state.calibrations.length)} نمونه`;
    els.estBluBuy.textContent=e.buy?money(e.buy):'—';
    els.estBluSell.textContent=e.sell?money(e.sell):'—';
    els.basisBuyLabel.textContent=pct(b.buy);
    els.basisSellLabel.textContent=pct(b.sell);
    autoFillCalibrationReference();
    renderBluHistory(); drawBasisChart();
  }

  function drawBasisChart(){
    const {ctx,W,H}=prepareCanvas(els.basisChart);ctx.clearRect(0,0,W,H);
    const arr=state.calibrations.slice(-30);
    if(arr.length<2){ctx.fillStyle='#8095aa';ctx.font='11px Tahoma';ctx.textAlign='center';ctx.fillText('با چند نمونه، روند Basis اینجا شکل می‌گیرد.',W/2,H/2);return;}
    const vals=arr.flatMap(r=>[Number(r.basisBuy),Number(r.basisSell)]),mn=Math.min(...vals),mx=Math.max(...vals),span=Math.max(.2,mx-mn);
    const x=i=>8+i*(W-16)/(arr.length-1),y=v=>H-8-(v-(mn-span*.1))*(H-16)/(span*1.2);
    [['#f6c453','basisBuy'],['#35d79d','basisSell']].forEach(([color,key])=>{
      ctx.beginPath();arr.forEach((r,i)=>i?ctx.lineTo(x(i),y(Number(r[key]))):ctx.moveTo(x(i),y(Number(r[key]))));
      ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();
    });
  }

  function renderBluHistory(){
    const rows=state.calibrations.slice().reverse().slice(0,20);
    els.historyList.innerHTML=rows.length?rows.map(r=>`<div class="history-item">
      <span>${dtf.format(new Date(r.at))}</span>
      <span>مرجع <b>${money(r.ref)}</b></span>
      <span>خرید <b>${money(r.buy)}</b></span>
      <span>فروش <b>${money(r.sell)}</b></span>
    </div>`).join(''):'<div class="form-hint">هنوز نمونه‌ای ثبت نشده است.</div>';
  }

  function renderScenario(){
    const c=tradeCalc();
    els.cashAfterSell.textContent=c?money(c.cashAfterSell):'—';
    els.costToRebuy.textContent=c?money(c.costToRebuy):'—';
    els.netTradeProfit.textContent=c?money(c.profit):'—';
    els.netTradePct.textContent=c?signedPct(c.profitPct):'—';
    els.netTradeProfit.className=c?(c.profit>=0?'pos':'neg'):'';
    els.netTradePct.className=c?(c.profitPct>=0?'pos':'neg'):'';
  }

  function renderAll(){
    renderOverview();renderSources();drawMarketChart();renderBlu();renderScenario();
  }

  els.refreshMarket.addEventListener('click',refreshMarket);
  document.querySelectorAll('.asset-btn').forEach(btn=>btn.addEventListener('click',()=>{
    document.querySelectorAll('.asset-btn').forEach(b=>b.classList.toggle('active',b===btn));
    chartAsset=btn.dataset.asset;drawMarketChart();
  }));
  document.querySelectorAll('.range-btn').forEach(btn=>btn.addEventListener('click',()=>{
    if(btn.disabled)return;
    document.querySelectorAll('.range-btn').forEach(b=>b.classList.toggle('active',b===btn));
    chartHours=Number(btn.dataset.hours);drawMarketChart();
  }));

  els.calRef.addEventListener('input',()=>{calRefTouched=true;});
  els.saveCalibration.addEventListener('click',()=>{
    const ref=num(els.calRef.value),buy=num(els.calBuy.value),sell=num(els.calSell.value);
    if(!(ref>0&&buy>0&&sell>0)){els.calibrationResult.textContent='مرجع، خرید بلو و فروش بلو را کامل وارد کن.';return;}
    const row={at:Date.now(),ref,buy,sell,basisBuy:(buy/ref-1)*100,basisSell:(sell/ref-1)*100};
    state.calibrations.push(row);
    if(state.calibrations.length>1000) state.calibrations=state.calibrations.slice(-1000);
    save();
    els.calibrationResult.textContent=`ثبت شد • Basis خرید ${pct(row.basisBuy)} • فروش ${pct(row.basisSell)}`;
    els.calBuy.value='';els.calSell.value='';calRefTouched=false;renderBlu();renderScenario();
  });

  els.setManualRef.addEventListener('click',()=>{
    const v=num(els.manualRef.value);if(v>0){state.manualReference=Math.round(v);save();calRefTouched=false;renderBlu();renderScenario();}
  });
  els.clearManualRef.addEventListener('click',()=>{
    state.manualReference=null;els.manualRef.value='';save();calRefTouched=false;renderBlu();renderScenario();
  });

  ['tradeCapital','feePct','dropPct'].forEach(id=>els[id].addEventListener('input',()=>{
    if(id==='tradeCapital')state.settings.tradeCapital=num(els.tradeCapital.value)||0;
    if(id==='feePct')state.settings.feePct=num(els.feePct.value)||0;
    if(id==='dropPct')state.settings.dropPct=num(els.dropPct.value)||0;
    save();renderScenario();
  }));

  function download(name,text,type){
    const b=new Blob([text],{type}),a=document.createElement('a');
    a.href=URL.createObjectURL(b);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }
  els.exportJson.addEventListener('click',()=>download(`karen-fuse-blu-${Date.now()}.json`,JSON.stringify({version:VERSION,calibrations:state.calibrations},null,2),'application/json'));
  els.importJson.addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{const j=JSON.parse(await file.text());if(!Array.isArray(j.calibrations))throw new Error('bad');state.calibrations=j.calibrations.slice(-1000);save();renderBlu();renderScenario();}
    catch{alert('فایل معتبر نیست.');}
  });
  els.clearData.addEventListener('click',()=>{
    if(confirm('همه نمونه‌های بلو پاک شوند؟')){state.calibrations=[];save();renderBlu();renderScenario();}
  });

  function updateNet(){
    els.netStatus.textContent=navigator.onLine?'آنلاین':'آفلاین';
    els.netStatus.classList.toggle('neg',!navigator.onLine);
  }
  window.addEventListener('online',()=>{updateNet();refreshMarket();});
  window.addEventListener('offline',updateNet);
  window.addEventListener('resize',()=>{drawMarketChart();drawBasisChart();drawSpark(els.goldSpark,recentPoints('gold',1),'gold');});

  function hydrate(){
    els.tradeCapital.value=String(state.settings.tradeCapital||15000000);
    els.feePct.value=String(state.settings.feePct??0.5);
    els.dropPct.value=String(state.settings.dropPct??2);
    if(state.manualReference)els.manualRef.value=String(state.manualReference);
  }

  hydrate();
  updateNet();
  renderAll();
  refreshMarket();
  setInterval(refreshMarket,POLL_MS);
  setInterval(()=>{ if(latest?.generated_at){ els.dataAge.textContent=`${ageLabel(latest.generated_at)} پیش`; updateFuse(latest.generated_at); } },10_000);

  if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
})();
