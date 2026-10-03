(() => {
  'use strict';

  const VERSION = '0.4.1';
  const STORE_KEY = 'karenFuse.v04';
  const LEGACY_KEYS = ['karenFuse.v03','karenFuse.v02'];
  const RAW_BASE = 'https://raw.githubusercontent.com/mckaren8089-stack/karen-fuse/main/data';
  const EXPECTED_DATA_SECONDS = 300;
  const LATEST_POLL_MS = 60_000;
  const HISTORY_POLL_MS = 315_000;
  const LONG_HISTORY_POLL_MS = 30 * 60_000;
  const LOCAL_HISTORY_LIMIT = 1000;
  const MANUAL_REF_TTL_MS = 60 * 60 * 1000;
  const GAP_WARN_MS = 45 * 60 * 1000;

  const nf = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 });
  const pf = new Intl.NumberFormat('fa-IR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const gf = new Intl.NumberFormat('fa-IR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
  const xf = new Intl.NumberFormat('fa-IR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dtf = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'short' });

  const $ = id => document.getElementById(id);
  const ids = [
    'netStatus','dataAge','goldPrice','goldMove','goldSpread','goldMin','goldMax','goldSpark',
    'usdPrice','usdMove','usdBuy','usdSell','usdSourceNote',
    'xauPrice','xauSourceNote',
    'fuseRing','fuseMinutes','fuseState','fuseDetail',
    'refreshMarket','sourceGrid','sourceFooter',
    'chartTitle','marketChart','chartEmpty','chartTooltip','chartSource','chartLastPoint','chartGap',
    'rangeChange','rangeLow','rangeHigh','rangeCoverage',
    'sampleCount','bluReferenceDisplay','referenceMode','calRef','calBuy','calSell','calNote',
    'saveCalibration','calibrationResult','calibrationPreview',
    'estBluBuy','estBluSell','basisBuyLabel','basisSellLabel','basisChart',
    'calcBuy','calcSell','calcReference','calcFee','calcToman','calcGold','calcReferenceNote',
    'invoiceDirection','invoiceReference','invoiceInput','invoiceGross','invoiceFeePct','invoiceFeeAmount',
    'invoiceFinal','invoiceTimestamp','invoiceSourceCount','invoiceSpread','invoiceQuality',
    'manualRef','setManualRef','clearManualRef',
    'historyList','exportJson','importJson','clearData'
  ];
  const els = Object.fromEntries(ids.map(id => [id, $(id)]));

  const defaults = {
    version: VERSION,
    calibrations: [],
    manualReference: null,
    manualReferenceAt: null,
    calculator: {
      direction: 'buy',
      reference: 'market',
      buyFeePct: 0.5,
      sellFeePct: 0.5,
      lastInput: 'toman',
      toman: 50_000_000,
      gold: 1
    },
    lastMarket: null,
    marketHistory: []
  };

  let state = load();
  let latest = state.lastMarket || null;
  let history = Array.isArray(state.marketHistory) ? state.marketHistory : [];
  let compactHistory = [];
  let dailyHistory = null;
  let chartAsset = 'gold';
  let chartHours = 24;
  let chartHoverIndex = null;
  let chartRender = null;
  let chartHoverTimer = null;
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
    if(raw?.settings && !raw?.calculator){
      const legacyFee=Number(raw.settings.feePct);
      if(Number.isFinite(legacyFee)){
        s.calculator.buyFeePct=legacyFee;
        s.calculator.sellFeePct=legacyFee;
      }
      const legacyCapital=Number(raw.settings.tradeCapital);
      if(legacyCapital>0) s.calculator.toman=legacyCapital;
    }
    s.version=VERSION;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch {}
    return s;
  }
  function save(){ try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {} }

  function num(v){
    if(v == null) return NaN;
    return Number(String(v)
      .replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
      .replace(/[٬,\s]/g,'')
      .replace('٫','.'));
  }
  function money(v){ return Number.isFinite(Number(v)) && Number(v)>0 ? nf.format(Math.round(Number(v))) : '—'; }
  function grams(v){ return Number.isFinite(Number(v)) && Number(v)>0 ? gf.format(Number(v)) : '—'; }
  function xauMoney(v){ return Number.isFinite(Number(v)) && Number(v)>0 ? '$' + xf.format(Number(v)) : '—'; }
  function pct(v){ return Number.isFinite(Number(v)) ? pf.format(Number(v)) + '٪' : '—'; }
  function signedPct(v){
    if(!Number.isFinite(v)) return '—';
    return (v>0?'+':'') + pf.format(v) + '٪';
  }
  function ageSeconds(ts){
    const t = new Date(ts || 0).getTime();
    if(!Number.isFinite(t) || !t) return Infinity;
    return Math.max(0,(Date.now()-t)/1000);
  }
  function ageLabel(ts){
    const s=ageSeconds(ts);
    if(!Number.isFinite(s)) return '—';
    if(s<60) return nf.format(Math.round(s))+' ثانیه';
    if(s<3600) return nf.format(Math.round(s/60))+' دقیقه';
    if(s<86400) return nf.format(Math.round(s/3600))+' ساعت';
    return nf.format(Math.round(s/86400))+' روز';
  }
  function escapeHtml(s){ return String(s ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function snapshotTs(){ return latest?.snapshot_ts || latest?.generated_at || null; }
  function qualityLabel(q){
    const level=typeof q==='string'?q:q?.level;
    return ({high:'بالا',medium:'متوسط',low:'پایین',single_source:'تک‌منبع',unavailable:'ناموجود'})[level] || '—';
  }
  function formatMoneyField(el){
    const v=num(el?.value);
    if(el && v>0) el.value=nf.format(Math.round(v));
  }
  function formatGoldField(el){
    const v=num(el?.value);
    if(el && v>0) el.value=gf.format(v);
  }

  function marketConsensusPrice(){
    return Number(latest?.consensus?.gold18_toman || 0) || null;
  }
  function manualRefState(){
    const value=Number(state.manualReference);
    if(!(value>0)) return {value:null,active:false,expired:false,ageMs:Infinity};
    const at=Number(state.manualReferenceAt||0);
    const ageMs=at>0?Math.max(0,Date.now()-at):Infinity;
    return {value,active:ageMs<=MANUAL_REF_TTL_MS,expired:ageMs>MANUAL_REF_TTL_MS,ageMs};
  }
  function refPrice(){
    const manual=manualRefState();
    if(manual.active) return manual.value;
    return marketConsensusPrice();
  }

  function calParts(raw){
    const ts=raw?.timestamp ?? raw?.at;
    let at;
    if(typeof ts==='number') at=ts;
    else at=new Date(ts || 0).getTime();
    const ref=Number(raw?.reference_gold18 ?? raw?.ref);
    const buy=Number(raw?.blu_buy_quote ?? raw?.buy);
    const sell=Number(raw?.blu_sell_quote ?? raw?.sell);
    return {
      at:Number.isFinite(at)&&at>0?at:Date.now(),
      timestamp:new Date(Number.isFinite(at)&&at>0?at:Date.now()).toISOString(),
      ref,buy,sell,
      note:String(raw?.note || '').slice(0,280)
    };
  }

  function validCalibrationValues(ref,buy,sell){
    const plausible=v=>Number.isFinite(v)&&v>=1_000_000&&v<=100_000_000;
    return plausible(ref)&&plausible(buy)&&plausible(sell);
  }

  function basisModel(){
    if(!window.KarenCalc?.bluBasis) return {buy:0,sell:0,count:0,latestAt:null};
    return window.KarenCalc.bluBasis(state.calibrations,{
      windowHours:72,
      maxSamples:8,
      maxDeltaPct:2.5
    });
  }

  function estimates(){
    const ref=refPrice(), b=basisModel();
    if(!ref) return {ref:null,b,buy:null,sell:null};
    return {ref,b,buy:ref*(1+b.buy/100),sell:ref*(1+b.sell/100)};
  }

  async function fetchJson(url){
    const sep=url.includes('?')?'&':'?';
    const r=await fetch(url+sep+'t='+Date.now(),{cache:'no-store'});
    if(!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  }

  async function refreshMarket({includeHistory=false,includeLong=false}={}){
    if(refreshBusy) return;
    refreshBusy=true;
    if(els.refreshMarket) els.refreshMarket.textContent='…';

    const tasks=[
      fetchJson(RAW_BASE+'/latest.json'),
      includeHistory?fetchJson(RAW_BASE+'/history.json'):Promise.resolve(null),
      includeLong?fetchJson(RAW_BASE+'/consensus_history.json'):Promise.resolve(null),
      includeLong?fetchJson(RAW_BASE+'/tgju_history.json'):Promise.resolve(null)
    ];
    const [latestResult,historyResult,compactResult,dailyResult]=await Promise.allSettled(tasks);
    let changed=false;

    if(latestResult.status==='fulfilled'){
      latest=latestResult.value;
      state.lastMarket=latest;
      changed=true;
    }else{
      latest=state.lastMarket;
      console.warn('latest refresh failed',latestResult.reason);
    }

    if(includeHistory){
      if(historyResult.status==='fulfilled'){
        const points=Array.isArray(historyResult.value?.points)?historyResult.value.points:[];
        history=points;
        state.marketHistory=points.slice(-LOCAL_HISTORY_LIMIT);
        changed=true;
      }else{
        history=Array.isArray(state.marketHistory)?state.marketHistory:[];
        console.warn('history refresh failed',historyResult.reason);
      }
    }else if(!Array.isArray(history) || !history.length){
      history=Array.isArray(state.marketHistory)?state.marketHistory:[];
    }

    if(includeLong){
      if(compactResult.status==='fulfilled') compactHistory=Array.isArray(compactResult.value?.points)?compactResult.value.points:[];
      else console.warn('compact history refresh failed',compactResult.reason);
      if(dailyResult.status==='fulfilled') dailyHistory=dailyResult.value;
      else console.warn('TGJU daily history refresh failed',dailyResult.reason);
    }

    if(changed) save();
    refreshBusy=false;
    if(els.refreshMarket) els.refreshMarket.textContent='↻';
    renderAll();
  }

  function sourceNumbers(asset){
    const values=[];
    Object.values(latest?.sources||{}).forEach(s=>{
      const status=asset==='gold'?s.gold18_status:asset==='usd'?s.usd_status:s.xau_status;
      const v=Number(asset==='gold'?s.gold18_toman:asset==='usd'?s.usd_toman:s.xau_usd);
      if((status==='OK' || (!status && s?.ok)) && v>0) values.push(v);
    });
    return values;
  }

  function pointTs(p){ return new Date(p?.snapshot_ts || p?.ts || 0).getTime(); }
  function pointValue(p,asset){
    if(p?.consensus){
      return Number(asset==='gold'?p.consensus.gold18_toman:asset==='usd'?p.consensus.usd_toman:p.consensus.xau_usd);
    }
    return Number(asset==='gold'?p?.gold18_toman:asset==='usd'?p?.usd_toman:p?.xau_usd);
  }
  function recentPoints(asset,hours=1,source=history){
    const cutoff=Date.now()-hours*3600e3;
    return (source||[])
      .map(p=>({ts:pointTs(p),v:pointValue(p,asset)}))
      .filter(p=>Number.isFinite(p.ts)&&p.ts>=cutoff&&p.v>0)
      .sort((a,b)=>a.ts-b.ts);
  }
  function compactPoints(asset,hours){
    return recentPoints(asset,hours,compactHistory);
  }
  function dailyPoints(asset,hours){
    const key=asset==='gold'?'gold':asset==='usd'?'usd':'xau';
    const rows=dailyHistory?.series?.[key];
    if(!Array.isArray(rows)) return [];
    const cutoff=Date.now()-hours*3600e3;
    return rows.map(r=>({
      ts:new Date(String(r.date)+'T12:00:00Z').getTime(),
      v:Number(r.close),
      low:Number(r.low),
      high:Number(r.high),
      open:Number(r.open)
    })).filter(p=>p.ts>=cutoff&&p.v>0).sort((a,b)=>a.ts-b.ts);
  }
  function moveFromHistory(asset){
    const arr=recentPoints(asset,1);
    if(arr.length<2) return NaN;
    const first=arr[0].v,last=arr[arr.length-1].v;
    return first?((last/first)-1)*100:NaN;
  }

  function renderOverview(){
    if(!latest) return;
    const gold=Number(latest?.consensus?.gold18_toman),usd=Number(latest?.consensus?.usd_toman),xau=Number(latest?.consensus?.xau_usd);
    els.goldPrice.textContent=money(gold);
    els.usdPrice.textContent=money(usd);
    els.xauPrice.textContent=xauMoney(xau);

    setMove(els.goldMove,moveFromHistory('gold'));
    setMove(els.usdMove,moveFromHistory('usd'));

    const gvals=sourceNumbers('gold');
    els.goldSpread.textContent=pct(latest?.spread?.gold_pct);
    els.goldMin.textContent=gvals.length?money(Math.min(...gvals)):'—';
    els.goldMax.textContent=gvals.length?money(Math.max(...gvals)):'—';

    const sources=latest?.sources||{};
    const bidask=Object.values(sources).find(s=>Number(s?.usd_buy_toman)>0&&Number(s?.usd_sell_toman)>0) || {};
    els.usdBuy.textContent=money(bidask.usd_buy_toman);
    els.usdSell.textContent=money(bidask.usd_sell_toman);
    els.usdSourceNote.textContent=bidask?.name
      ? 'خرید/فروش: '+bidask.name+' • عدد بزرگ: اجماع'
      : 'عدد بزرگ: اجماع منابع';

    const xCount=latest?.source_counts?.xau ?? sourceNumbers('xau').length;
    const xSpread=latest?.spread?.xau_pct;
    els.xauSourceNote.textContent='منبع '+nf.format(xCount)+' • کیفیت '+qualityLabel(latest?.quality?.xau)+(Number.isFinite(Number(xSpread))?' • اختلاف '+pct(xSpread):'');

    const ts=snapshotTs();
    els.dataAge.textContent=ageLabel(ts)+' پیش';
    updateFuse(ts);
    drawSpark(els.goldSpark,recentPoints('gold',1),'gold');
  }

  function setMove(el,v){
    if(!el) return;
    el.className='move-badge '+(!Number.isFinite(v)?'neutral':v>0?'pos':v<0?'neg':'neutral');
    el.textContent=Number.isFinite(v)?signedPct(v):'—';
    el.title='تغییر نسبت به نخستین دادهٔ موجود در یک ساعت اخیر';
  }

  function updateFuse(ts){
    if(!els.fuseRing) return;
    const sec=ageSeconds(ts);
    const freshness=Math.max(0,Math.min(100,100-sec/EXPECTED_DATA_SECONDS*100));
    els.fuseRing.style.setProperty('--fresh',freshness+'%');
    els.fuseMinutes.textContent=sec<60?'<۱د':nf.format(Math.round(sec/60))+'د';
    if(sec<=360){
      els.fuseState.textContent='بازار تازه';
      els.fuseState.className='pos';
      els.fuseDetail.textContent='آخرین Snapshot نزدیک به چرخه هدف است';
    }else if(sec<=900){
      els.fuseState.textContent='کمی تأخیر';
      els.fuseState.className='warn';
      els.fuseDetail.textContent='GitHub Actions با تأخیر اجرا شده است';
    }else{
      els.fuseState.textContent='داده کهنه';
      els.fuseState.className='neg';
      els.fuseDetail.textContent='شکاف زمانی وجود دارد؛ عدد ساختگی جایگزین نمی‌شود';
    }
  }

  function renderSources(){
    const sources=latest?.sources||{};
    const preferred=['alanchand','tgju','estjt','navasan_widget','gold_api','tgju_xau','pashizi','zarscan','geram18'];
    const keys=[...preferred.filter(k=>sources[k]),...Object.keys(sources).filter(k=>!preferred.includes(k))];
    const healthy=s=>s?.status==='OK'||(!s?.status&&s?.ok);

    const specs=[
      {
        key:'gold',title:'طلای ۱۸ عیار',unit:'تومان / گرم',
        rows:keys.filter(k=>healthy(sources[k]) && Number(sources[k]?.gold18_toman)>0).map(k=>{
          const s=sources[k];
          return {key:k,name:s.name||k,value:money(s.gold18_toman),detail:'مرجع طلا',time:s.collected_at||s.updated_at};
        })
      },
      {
        key:'usd',title:'دلار آزاد',unit:'تومان',
        rows:keys.filter(k=>healthy(sources[k]) && (Number(sources[k]?.usd_toman)>0||Number(sources[k]?.usd_buy_toman)>0||Number(sources[k]?.usd_sell_toman)>0)).map(k=>{
          const s=sources[k];
          let detail='قیمت منبع';
          if(Number(s.usd_buy_toman)>0&&Number(s.usd_sell_toman)>0){
            detail='خرید '+money(s.usd_buy_toman)+' • فروش '+money(s.usd_sell_toman);
          }
          return {key:k,name:s.name||k,value:money(s.usd_toman||s.usd_sell_toman||s.usd_buy_toman),detail,time:s.collected_at||s.updated_at};
        })
      },
      {
        key:'xau',title:'اونس جهانی',unit:'XAU/USD',
        rows:keys.filter(k=>healthy(sources[k]) && Number(sources[k]?.xau_usd)>0).map(k=>{
          const s=sources[k];
          return {key:k,name:s.name||k,value:xauMoney(s.xau_usd),detail:'اونس / دلار',time:s.collected_at||s.updated_at};
        })
      }
    ];

    els.sourceGrid.innerHTML=specs.map(group=>
      '<section class="asset-source-group asset-source-'+group.key+'">'+
        '<div class="asset-source-heading"><strong>'+group.title+'</strong><span>'+group.unit+'</span></div>'+
        '<div class="asset-source-cards">'+
          (group.rows.length?group.rows.map(row=>
            '<article class="source-tile">'+
              '<div class="source-name"><strong>'+escapeHtml(row.name)+'</strong><i class="live-dot"></i></div>'+
              '<div class="source-quote">'+row.value+'</div>'+
              '<div class="source-detail">'+row.detail+'</div>'+
              '<div class="source-time">'+ageLabel(row.time)+' پیش</div>'+
            '</article>'
          ).join(''):'<div class="source-empty">منبع سالمی موجود نیست.</div>')+
        '</div>'+
      '</section>'
    ).join('');

    const active=keys.filter(k=>healthy(sources[k]));
    const unhealthy=keys.filter(k=>!active.includes(k));
    const counts=latest?.source_counts||{};
    const failedNames=unhealthy.map(k=>{
      const s=sources[k];
      return (s?.name||k)+(s?.status&&s.status!=='MISSING'?' ('+s.status+')':'');
    });
    els.sourceFooter.textContent=
      'طلا '+nf.format(counts.gold??sourceNumbers('gold').length)+' منبع • دلار '+nf.format(counts.usd??sourceNumbers('usd').length)+' منبع • اونس '+nf.format(counts.xau??sourceNumbers('xau').length)+' منبع'+
      (failedNames.length?' • خارج از اجماع: '+failedNames.join('، '):'');
  }

  function selectChartSeries(){
    if(chartHours<=72){
      return {arr:recentPoints(chartAsset,chartHours),source:'اجماع Karen Fuse',mode:'intraday'};
    }
    const compact=compactPoints(chartAsset,chartHours);
    if(compact.length>=2){
      const coverage=(compact[compact.length-1].ts-compact[0].ts)/3600e3;
      if(coverage>=Math.min(chartHours*.8,chartHours-24)){
        return {arr:compact,source:'اجماع Karen Fuse • آرشیو فشرده',mode:'compact'};
      }
    }
    const daily=dailyPoints(chartAsset,chartHours);
    return {arr:daily,source:'TGJU • تاریخچه روزانه',mode:'daily'};
  }

  function updateRangeButtons(){
    document.querySelectorAll('.range-btn').forEach(btn=>{
      const h=Number(btn.dataset.hours);
      let points;
      if(h<=72) points=recentPoints(chartAsset,h);
      else points=compactPoints(chartAsset,h).length>=2?compactPoints(chartAsset,h):dailyPoints(chartAsset,h);
      btn.disabled=points.length<2;
      btn.title=btn.disabled?'داده کافی برای این بازه هنوز در دسترس نیست':'';
      if(btn.classList.contains('active')&&btn.disabled){
        btn.classList.remove('active');
        const fallback=[...document.querySelectorAll('.range-btn')].find(b=>!b.disabled);
        if(fallback){fallback.classList.add('active');chartHours=Number(fallback.dataset.hours);}
      }
    });
  }

  function formatCoverage(h){
    if(h<1) return nf.format(Math.max(1,Math.round(h*60)))+' دقیقه';
    if(h<24) return nf.format(Math.round(h*10)/10)+' ساعت';
    return nf.format(Math.round(h/24*10)/10)+' روز';
  }

  function prepareCanvas(canvas){
    const dpr=Math.max(1,Math.min(2,window.devicePixelRatio||1));
    const rect=canvas.getBoundingClientRect();
    canvas.width=Math.max(1,Math.floor(rect.width*dpr));
    canvas.height=Math.max(1,Math.floor(rect.height*dpr));
    const ctx=canvas.getContext('2d');
    ctx.setTransform(dpr,0,0,dpr,0,0);
    return {ctx,W:rect.width,H:rect.height};
  }

  function drawMarketChart(){
    updateRangeButtons();
    const {arr,source,mode}=selectChartSeries();
    const canvas=els.marketChart;
    const {ctx,W,H}=prepareCanvas(canvas);
    ctx.clearRect(0,0,W,H);
    els.chartEmpty.hidden=arr.length>=2;

    const titles={gold:'طلای ۱۸ عیار',usd:'دلار آزاد',xau:'اونس جهانی طلا'};
    els.chartTitle.textContent=titles[chartAsset];
    els.chartSource.textContent=source;

    if(arr.length<2){
      els.rangeChange.textContent='—';els.rangeLow.textContent='—';els.rangeHigh.textContent='—';els.rangeCoverage.textContent='—';
      els.chartLastPoint.textContent='بدون داده';
      els.chartGap.textContent='—';
      chartRender=null;
      els.chartTooltip.hidden=true;
      return;
    }

    const now=Date.now();
    const start=now-chartHours*3600e3;
    const end=now;
    const vals=arr.map(p=>p.v);
    const min0=Math.min(...vals),max0=Math.max(...vals);
    const span=Math.max(chartAsset==='xau'?.01:1,max0-min0);
    const min=min0-span*.16,max=max0+span*.16;
    const pad={l:10,r:10,t:22,b:28};
    const x=t=>pad.l+(t-start)*(W-pad.l-pad.r)/(end-start||1);
    const y=v=>H-pad.b-(v-min)*(H-pad.t-pad.b)/(max-min||1);

    ctx.strokeStyle='rgba(119,151,181,.18)';ctx.lineWidth=1;
    for(let i=0;i<4;i++){
      const yy=pad.t+i*(H-pad.t-pad.b)/3;
      ctx.beginPath();ctx.moveTo(pad.l,yy);ctx.lineTo(W-pad.r,yy);ctx.stroke();
    }

    const color=chartAsset==='gold'?'#f6c453':chartAsset==='usd'?'#6bb6ff':'#52d7e8';
    const gapLimit=mode==='intraday'?GAP_WARN_MS:Infinity;
    ctx.beginPath();
    arr.forEach((p,i)=>{
      const px=x(p.ts),py=y(p.v);
      if(!i || (p.ts-arr[i-1].ts)>gapLimit) ctx.moveTo(px,py);
      else ctx.lineTo(px,py);
    });
    ctx.strokeStyle=color;ctx.lineWidth=2.4;ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke();

    const last=arr[arr.length-1];
    ctx.beginPath();ctx.arc(x(last.ts),y(last.v),4,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();

    ctx.fillStyle='rgba(190,207,223,.72)';ctx.font='10px Tahoma';ctx.textAlign='left';
    const displayValue=v=>chartAsset==='xau'?xauMoney(v):money(v);
    ctx.fillText(displayValue(max0),pad.l+2,pad.t+2);
    ctx.fillText(displayValue(min0),pad.l+2,H-pad.b-5);

    const change=(arr[arr.length-1].v/arr[0].v-1)*100;
    els.rangeChange.textContent=signedPct(change);
    els.rangeChange.className=change>0?'pos':change<0?'neg':'';
    els.rangeLow.textContent=displayValue(min0);
    els.rangeHigh.textContent=displayValue(max0);
    els.rangeCoverage.textContent=formatCoverage((arr[arr.length-1].ts-arr[0].ts)/3600e3);
    els.chartLastPoint.textContent=mode==='daily'?dtf.format(new Date(last.ts)):ageLabel(last.ts)+' پیش';

    let largestGap=0;
    for(let i=1;i<arr.length;i++) largestGap=Math.max(largestGap,arr[i].ts-arr[i-1].ts);
    const tailGap=end-last.ts;
    if(mode==='intraday' && (tailGap>GAP_WARN_MS || largestGap>GAP_WARN_MS)){
      const g=Math.max(tailGap,largestGap);
      els.chartGap.textContent='شکاف '+formatCoverage(g/3600e3);
      els.chartGap.className='warn';
    }else{
      els.chartGap.textContent=mode==='daily'?'کندل روزانه':'بدون شکاف بزرگ';
      els.chartGap.className='';
    }

    chartRender={arr,start,end,pad,W,H,min,max,x,y,mode,color,displayValue};
    if(chartHoverIndex!=null && chartHoverIndex>=arr.length) chartHoverIndex=null;
    drawChartHover(ctx);
  }

  function drawChartHover(ctx){
    if(!chartRender || chartHoverIndex==null) {
      if(els.chartTooltip) els.chartTooltip.hidden=true;
      return;
    }
    const {arr,x,y,pad,H,color,displayValue}=chartRender;
    const p=arr[chartHoverIndex];
    if(!p) return;
    const px=x(p.ts),py=y(p.v);
    ctx.save();
    ctx.setLineDash([4,4]);
    ctx.strokeStyle='rgba(255,255,255,.42)';
    ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(px,pad.t);ctx.lineTo(px,H-pad.b);ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();ctx.arc(px,py,5,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();
    ctx.restore();

    if(els.chartTooltip){
      els.chartTooltip.hidden=false;
      els.chartTooltip.innerHTML='<strong>'+displayValue(p.v)+'</strong><span>'+dtf.format(new Date(p.ts))+'</span>';
      const left=Math.max(8,Math.min(chartRender.W-142,px-65));
      const top=Math.max(8,Math.min(H-66,py-58));
      els.chartTooltip.style.left=left+'px';
      els.chartTooltip.style.top=top+'px';
    }
  }

  function chartPointer(e){
    if(!chartRender?.arr?.length) return;
    const rect=els.marketChart.getBoundingClientRect();
    const px=Math.max(chartRender.pad.l,Math.min(chartRender.W-chartRender.pad.r,e.clientX-rect.left));
    const target=chartRender.start+(px-chartRender.pad.l)/(chartRender.W-chartRender.pad.l-chartRender.pad.r)*(chartRender.end-chartRender.start);
    let best=0,dist=Infinity;
    chartRender.arr.forEach((p,i)=>{
      const d=Math.abs(p.ts-target);
      if(d<dist){dist=d;best=i;}
    });
    chartHoverIndex=best;
    drawMarketChart();
  }

  function clearChartHover(delay=0){
    clearTimeout(chartHoverTimer);
    chartHoverTimer=setTimeout(()=>{
      chartHoverIndex=null;
      if(els.chartTooltip) els.chartTooltip.hidden=true;
      drawMarketChart();
    },delay);
  }

  function drawSpark(canvas,arr,asset){
    const {ctx,W,H}=prepareCanvas(canvas);ctx.clearRect(0,0,W,H);
    if(arr.length<2) return;
    const vals=arr.map(p=>p.v),mn=Math.min(...vals),mx=Math.max(...vals),span=Math.max(1,mx-mn);
    const x=i=>i*(W/(arr.length-1)),y=v=>H-6-(v-(mn-span*.1))*(H-12)/(span*1.2);
    const color=asset==='gold'?'#f6c453':'#6bb6ff';
    ctx.beginPath();arr.forEach((p,i)=>i?ctx.lineTo(x(i),y(p.v)):ctx.moveTo(x(i),y(p.v)));
    ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();
  }

  function autoFillCalibrationReference(){
    const r=refPrice(),manual=manualRefState();
    els.bluReferenceDisplay.textContent=r?money(r)+' تومان':'—';
    if(manual.active){
      els.referenceMode.textContent='دستی • '+nf.format(Math.max(1,Math.round(manual.ageMs/60000)))+'د';
    }else if(manual.expired){
      els.referenceMode.textContent='دستی منقضی • اجماع';
    }else{
      els.referenceMode.textContent='اجماع';
    }
    if(r && (!calRefTouched || !num(els.calRef.value))) els.calRef.value=nf.format(Math.round(r));
  }

  function validateCalibration(ref,buy,sell,{interactive=false}={}){
    if(!validCalibrationValues(ref,buy,sell)) return 'اعداد خارج از محدوده معتبر طلای ۱۸ عیار هستند.';
    const maxDeviation=Math.max(Math.abs(buy/ref-1),Math.abs(sell/ref-1))*100;
    if(maxDeviation>10) return 'اختلاف با مرجع بیش از ۱۰٪ است؛ احتمال خطای ورود عدد زیاد است.';
    if(interactive && maxDeviation>3){
      if(!confirm('اختلاف یکی از قیمت‌ها با مرجع '+pf.format(maxDeviation)+'٪ است. از ثبت این نمونه مطمئنی؟')) return 'ثبت نمونه لغو شد.';
    }
    return '';
  }

  function normalizeCalibration(raw){
    const p=calParts(raw);
    if(validateCalibration(p.ref,p.buy,p.sell)) return null;
    return {
      timestamp:p.timestamp,
      reference_gold18:p.ref,
      blu_buy_quote:p.buy,
      blu_sell_quote:p.sell,
      note:p.note || ''
    };
  }

  function previewCalibration(){
    const ref=num(els.calRef.value),buy=num(els.calBuy.value),sell=num(els.calSell.value);
    if(!(ref>0&&buy>0&&sell>0)){
      els.calibrationPreview.textContent='قبل از ثبت، اختلاف خرید و فروش با مرجع اینجا دیده می‌شود.';
      els.calibrationPreview.className='form-hint';
      return;
    }
    const db=(buy/ref-1)*100,ds=(sell/ref-1)*100;
    const maxDev=Math.max(Math.abs(db),Math.abs(ds));
    els.calibrationPreview.textContent='خرید '+signedPct(db)+' • فروش '+signedPct(ds)+' نسبت به مرجع';
    els.calibrationPreview.className='form-hint '+(maxDev>10?'neg':maxDev>3?'warn':'pos');
  }

  function renderBlu(){
    const e=estimates(),b=e.b;
    els.sampleCount.textContent=nf.format(state.calibrations.length)+' نمونه';
    els.estBluBuy.textContent=e.buy?money(e.buy):'—';
    els.estBluSell.textContent=e.sell?money(e.sell):'—';
    els.basisBuyLabel.textContent=pct(b.buy);
    els.basisSellLabel.textContent=pct(b.sell);
    if(b.latestAt){
      els.estBluBuy.title='مبتنی بر آخرین نمونه معتبر Blu: '+dtf.format(new Date(b.latestAt));
      els.estBluSell.title=els.estBluBuy.title;
    }
    autoFillCalibrationReference();
    renderBluHistory();
    drawBasisChart();
    previewCalibration();
  }

  function drawBasisChart(){
    const {ctx,W,H}=prepareCanvas(els.basisChart);ctx.clearRect(0,0,W,H);
    const arr=state.calibrations.map(calParts).filter(r=>validCalibrationValues(r.ref,r.buy,r.sell)).slice(-30);
    if(arr.length<2){
      ctx.fillStyle='#8095aa';ctx.font='11px Tahoma';ctx.textAlign='center';
      ctx.fillText('با چند نمونه، روند Basis اینجا شکل می‌گیرد.',W/2,H/2);return;
    }
    const vals=arr.flatMap(r=>[(r.buy/r.ref-1)*100,(r.sell/r.ref-1)*100]);
    const mn=Math.min(...vals),mx=Math.max(...vals),span=Math.max(.2,mx-mn);
    const x=i=>8+i*(W-16)/(arr.length-1),y=v=>H-8-(v-(mn-span*.1))*(H-16)/(span*1.2);
    [[ '#f6c453','buy' ],[ '#35d79d','sell' ]].forEach(([color,key])=>{
      ctx.beginPath();
      arr.forEach((r,i)=>{
        const v=(r[key]/r.ref-1)*100;
        i?ctx.lineTo(x(i),y(v)):ctx.moveTo(x(i),y(v));
      });
      ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();
    });
  }

  function renderBluHistory(){
    const rows=state.calibrations.slice().reverse().slice(0,20).map(calParts);
    els.historyList.innerHTML=rows.length?rows.map(r=>
      '<div class="history-item">'+
      '<span>'+dtf.format(new Date(r.at))+'</span>'+
      '<span>مرجع <b>'+money(r.ref)+'</b></span>'+
      '<span>خرید <b>'+money(r.buy)+'</b></span>'+
      '<span>فروش <b>'+money(r.sell)+'</b></span>'+
      (r.note?'<span class="history-note">'+escapeHtml(r.note)+'</span>':'')+
      '</div>'
    ).join(''):'<div class="form-hint">هنوز نمونه‌ای ثبت نشده است.</div>';
  }

  function selectedCalcPrice(){
    const direction=state.calculator.direction;
    if(state.calculator.reference==='blu'){
      const e=estimates();
      if(e.b.count>0 && Number(direction==='buy'?e.buy:e.sell)>0){
        return {price:Number(direction==='buy'?e.buy:e.sell),label:'تخمین Blu',fallback:false};
      }
      return {price:marketConsensusPrice(),label:'اجماع بازار',fallback:true};
    }
    return {price:marketConsensusPrice(),label:'اجماع بازار',fallback:false};
  }

  function currentCalcFee(){
    return Number(state.calculator.direction==='buy'?state.calculator.buyFeePct:state.calculator.sellFeePct);
  }

  function formatCalcResult(value,unit){
    return unit==='gold'?grams(value)+' گرم':money(value)+' تومان';
  }

  function renderCalculator(){
    const c=state.calculator;
    els.calcBuy.classList.toggle('active',c.direction==='buy');
    els.calcSell.classList.toggle('active',c.direction==='sell');
    els.calcReference.value=c.reference;
    const fee=currentCalcFee();
    if(document.activeElement!==els.calcFee) els.calcFee.value=String(Number.isFinite(fee)?fee:0.5);

    const selected=selectedCalcPrice();
    const b=basisModel();
    const bluAge=b.latestAt?ageLabel(b.latestAt):'—';
    const marketAge=ageLabel(snapshotTs());
    els.calcReferenceNote.textContent=selected.fallback
      ? 'هنوز نمونه Blu معتبر نداریم؛ محاسبه فعلاً با اجماع بازار انجام می‌شود.'
      : selected.label==='تخمین Blu'
        ? 'مرجع: تخمین Blu • آخرین نمونه Blu '+bluAge+' پیش • Snapshot بازار '+marketAge+' پیش'
        : 'مرجع: اجماع بازار • Snapshot '+marketAge+' پیش';
    els.calcReferenceNote.className='form-hint '+(selected.fallback?'warn':'');

    const inputType=c.lastInput==='gold'?'gold':'toman';
    const inputValue=inputType==='gold'?num(els.calcGold.value):num(els.calcToman.value);
    const result=window.KarenCalc?.calculate({
      direction:c.direction,
      inputType,
      inputValue,
      price:selected.price,
      feePct:fee
    });

    if(result){
      if(inputType==='toman' && document.activeElement!==els.calcGold) els.calcGold.value=gf.format(result.finalResult);
      if(inputType==='gold' && document.activeElement!==els.calcToman) els.calcToman.value=nf.format(Math.round(result.finalResult));
    }

    els.invoiceDirection.textContent=c.direction==='buy'?'خرید':'فروش';
    els.invoiceReference.textContent=selected.price?money(selected.price)+' تومان • '+selected.label:'—';
    els.invoiceInput.textContent=result
      ? (inputType==='toman'?money(result.inputValue)+' تومان':grams(result.inputValue)+' گرم')
      : '—';
    els.invoiceGross.textContent=result?formatCalcResult(result.grossResult,result.grossResultUnit):'—';
    els.invoiceFeePct.textContent=Number.isFinite(fee)?pct(fee):'—';
    els.invoiceFeeAmount.textContent=result?money(result.feeAmount)+' تومان':'—';
    els.invoiceFinal.textContent=result?formatCalcResult(result.finalResult,result.finalResultUnit):'—';
    els.invoiceTimestamp.textContent=snapshotTs()?dtf.format(new Date(snapshotTs())):'—';
    els.invoiceSourceCount.textContent=nf.format(latest?.source_counts?.gold ?? sourceNumbers('gold').length);
    els.invoiceSpread.textContent=pct(latest?.spread?.gold_pct);
    els.invoiceQuality.textContent=qualityLabel(latest?.quality?.gold);
  }

  function renderAll(){
    renderOverview();
    renderSources();
    drawMarketChart();
    renderBlu();
    renderCalculator();
  }

  els.refreshMarket.addEventListener('click',()=>refreshMarket({includeHistory:true,includeLong:true}));
  document.querySelectorAll('.asset-btn').forEach(btn=>btn.addEventListener('click',()=>{
    document.querySelectorAll('.asset-btn').forEach(b=>b.classList.toggle('active',b===btn));
    chartAsset=btn.dataset.asset;
    chartHoverIndex=null;
    drawMarketChart();
  }));
  document.querySelectorAll('.range-btn').forEach(btn=>btn.addEventListener('click',()=>{
    if(btn.disabled) return;
    document.querySelectorAll('.range-btn').forEach(b=>b.classList.toggle('active',b===btn));
    chartHours=Number(btn.dataset.hours);
    chartHoverIndex=null;
    drawMarketChart();
  }));

  els.marketChart.addEventListener('pointerdown',e=>{
    clearTimeout(chartHoverTimer);
    try{els.marketChart.setPointerCapture(e.pointerId);}catch{}
    chartPointer(e);
  });
  els.marketChart.addEventListener('pointermove',e=>{
    if(e.pointerType==='mouse' || e.buttons) chartPointer(e);
  });
  els.marketChart.addEventListener('pointerup',()=>clearChartHover(1800));
  els.marketChart.addEventListener('pointercancel',()=>clearChartHover(0));
  els.marketChart.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse')clearChartHover(0);});

  [els.calRef,els.calBuy,els.calSell].forEach(el=>{
    el.addEventListener('input',()=>{if(el===els.calRef)calRefTouched=true;previewCalibration();});
    el.addEventListener('blur',()=>{formatMoneyField(el);previewCalibration();});
  });

  els.saveCalibration.addEventListener('click',()=>{
    const ref=num(els.calRef.value),buy=num(els.calBuy.value),sell=num(els.calSell.value);
    if(!(ref>0&&buy>0&&sell>0)){
      els.calibrationResult.textContent='مرجع، خرید Blu و فروش Blu را کامل وارد کن.';return;
    }
    const issue=validateCalibration(ref,buy,sell,{interactive:true});
    if(issue){els.calibrationResult.textContent=issue;return;}
    const row=normalizeCalibration({
      timestamp:new Date().toISOString(),
      reference_gold18:ref,
      blu_buy_quote:buy,
      blu_sell_quote:sell,
      note:els.calNote.value.trim()
    });
    if(!row){els.calibrationResult.textContent='نمونه معتبر نیست.';return;}
    state.calibrations.push(row);
    if(state.calibrations.length>1000) state.calibrations=state.calibrations.slice(-1000);
    save();
    const p=calParts(row);
    els.calibrationResult.textContent='ثبت شد • Basis خرید '+signedPct((p.buy/p.ref-1)*100)+' • فروش '+signedPct((p.sell/p.ref-1)*100);
    els.calBuy.value='';els.calSell.value='';els.calNote.value='';calRefTouched=false;
    renderBlu();renderCalculator();
  });

  els.setManualRef.addEventListener('click',()=>{
    const v=num(els.manualRef.value);
    if(v>=1_000_000&&v<=100_000_000){
      state.manualReference=Math.round(v);
      state.manualReferenceAt=Date.now();
      save();calRefTouched=false;renderBlu();renderCalculator();
    }else alert('مرجع دستی معتبر نیست.');
  });
  els.clearManualRef.addEventListener('click',()=>{
    state.manualReference=null;state.manualReferenceAt=null;els.manualRef.value='';
    save();calRefTouched=false;renderBlu();renderCalculator();
  });
  els.manualRef.addEventListener('blur',()=>formatMoneyField(els.manualRef));

  function setCalcDirection(direction){
    state.calculator.direction=direction;
    els.calcFee.value=String(currentCalcFee());
    save();renderCalculator();
  }
  els.calcBuy.addEventListener('click',()=>setCalcDirection('buy'));
  els.calcSell.addEventListener('click',()=>setCalcDirection('sell'));
  els.calcReference.addEventListener('change',()=>{
    state.calculator.reference=els.calcReference.value==='blu'?'blu':'market';
    save();renderCalculator();
  });
  els.calcFee.addEventListener('input',()=>{
    const v=num(els.calcFee.value);
    if(state.calculator.direction==='buy') state.calculator.buyFeePct=Number.isFinite(v)?v:0;
    else state.calculator.sellFeePct=Number.isFinite(v)?v:0;
    save();renderCalculator();
  });
  els.calcToman.addEventListener('input',()=>{
    state.calculator.lastInput='toman';
    state.calculator.toman=num(els.calcToman.value)||0;
    save();renderCalculator();
  });
  els.calcGold.addEventListener('input',()=>{
    state.calculator.lastInput='gold';
    state.calculator.gold=num(els.calcGold.value)||0;
    save();renderCalculator();
  });
  els.calcToman.addEventListener('blur',()=>{formatMoneyField(els.calcToman);renderCalculator();});
  els.calcGold.addEventListener('blur',()=>{formatGoldField(els.calcGold);renderCalculator();});

  function download(name,text,type){
    const b=new Blob([text],{type}),a=document.createElement('a');
    a.href=URL.createObjectURL(b);a.download=name;a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }
  els.exportJson.addEventListener('click',()=>{
    const rows=state.calibrations.map(normalizeCalibration).filter(Boolean);
    download('karen-fuse-blu-'+Date.now()+'.json',JSON.stringify({version:VERSION,schema_version:2,calibrations:rows},null,2),'application/json');
  });
  els.importJson.addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{
      const j=JSON.parse(await file.text());
      if(!Array.isArray(j.calibrations)) throw new Error('فایل ساختار calibrations ندارد');
      const normalized=j.calibrations.map(normalizeCalibration);
      const invalid=normalized.filter(x=>!x).length;
      if(invalid) throw new Error(nf.format(invalid)+' نمونه نامعتبر در فایل وجود دارد');
      state.calibrations=normalized.slice(-1000);
      save();renderBlu();renderCalculator();
    }catch(err){alert(err?.message||'فایل معتبر نیست.');}
    finally{e.target.value='';}
  });
  els.clearData.addEventListener('click',()=>{
    if(confirm('همه نمونه‌های Blu پاک شوند؟')){
      state.calibrations=[];save();renderBlu();renderCalculator();
    }
  });

  function updateNet(){
    els.netStatus.textContent=navigator.onLine?'آنلاین':'آفلاین';
    els.netStatus.classList.toggle('neg',!navigator.onLine);
  }
  window.addEventListener('online',()=>{updateNet();refreshMarket({includeHistory:true,includeLong:true});});
  window.addEventListener('offline',updateNet);
  window.addEventListener('resize',()=>{
    drawMarketChart();drawBasisChart();drawSpark(els.goldSpark,recentPoints('gold',1),'gold');
  });

  function hydrate(){
    const c=state.calculator;
    els.calcToman.value=nf.format(Math.round(Number(c.toman)||50_000_000));
    els.calcGold.value=gf.format(Number(c.gold)||1);
    els.calcFee.value=String(currentCalcFee());
    els.calcReference.value=c.reference||'market';
    if(state.manualReference) els.manualRef.value=nf.format(state.manualReference);
  }

  hydrate();
  updateNet();
  renderAll();
  refreshMarket({includeHistory:true,includeLong:true});
  setInterval(()=>refreshMarket({includeHistory:false,includeLong:false}),LATEST_POLL_MS);
  setInterval(()=>refreshMarket({includeHistory:true,includeLong:false}),HISTORY_POLL_MS);
  setInterval(()=>refreshMarket({includeHistory:false,includeLong:true}),LONG_HISTORY_POLL_MS);
  setInterval(()=>{
    if(snapshotTs()){
      els.dataAge.textContent=ageLabel(snapshotTs())+' پیش';
      updateFuse(snapshotTs());
      if(chartHours<=72) drawMarketChart();
    }
  },10_000);

  if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
})();
