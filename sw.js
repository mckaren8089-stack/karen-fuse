const CACHE='karen-fuse-v0.4.1';
const ASSETS=['./','./index.html','./style.css','./calc.js','./app.js','./manifest.webmanifest','./icon.svg'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

async function networkFirst(request){
  const cache=await caches.open(CACHE);
  try{
    const response=await fetch(request,{cache:'no-store'});
    if(response && response.ok) cache.put(request,response.clone());
    return response;
  }catch{
    return (await cache.match(request)) || (await cache.match('./index.html'));
  }
}

async function cacheFirst(request){
  const cache=await caches.open(CACHE);
  const cached=await cache.match(request);
  if(cached) return cached;
  const response=await fetch(request);
  if(response && response.ok) cache.put(request,response.clone());
  return response;
}

self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin!==location.origin || event.request.method!=='GET') return;
  const isCore=event.request.mode==='navigate' ||
    /\/(?:index\.html|app\.js|calc\.js|style\.css|manifest\.webmanifest)$/.test(url.pathname);
  event.respondWith(isCore?networkFirst(event.request):cacheFirst(event.request));
});
