// Integrações opcionais do Menuza: Cloudflare Turnstile e Google Analytics com consentimento.
(function(){
  const configPromise=fetch('/api/public/integrations',{headers:{Accept:'application/json'},credentials:'same-origin'}).then(r=>r.ok?r.json():{}).catch(()=>({}));
  let turnstilePromise=null;
  async function loadTurnstile(){
    if(window.turnstile)return window.turnstile;
    if(!turnstilePromise)turnstilePromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async=true;script.defer=true;
      script.onload=()=>resolve(window.turnstile);
      script.onerror=reject;
      document.head.appendChild(script);
    });
    return turnstilePromise;
  }
  async function mountTurnstile(form){
    const config=await configPromise;
    if(!config.turnstileSiteKey||!form||!window.turnstile)return;
    const holder=form.querySelector('[data-turnstile]');
    if(!holder||holder.dataset.widgetId)return;
    const hidden=document.createElement('input');hidden.type='hidden';hidden.name='turnstileToken';form.appendChild(hidden);
    try{
      const id=window.turnstile.render(holder,{sitekey:config.turnstileSiteKey,theme:'auto',callback:token=>{hidden.value=token;},'expired-callback':()=>{hidden.value='';},'error-callback':()=>{hidden.value='';}});
      holder.dataset.widgetId=String(id);
    }catch{}
  }
  async function getTurnstileToken(form){
    const config=await configPromise;
    if(!config.turnstileSiteKey)return '';
    try{
      await loadTurnstile();
      await mountTurnstile(form);
      const holder=form?.querySelector('[data-turnstile]');
      const id=holder?.dataset.widgetId;
      const token=id?window.turnstile.getResponse(id):'';
      if(!token)throw new Error('Conclua a verificação antirrobô antes de continuar.');
      return token;
    }catch(error){throw new Error(error?.message||'Não foi possível carregar a verificação de segurança. Atualize a página.');}
  }
  async function initForm(form){
    const config=await configPromise;
    if(!config.turnstileSiteKey||!form?.querySelector('[data-turnstile]'))return;
    try{await loadTurnstile();await mountTurnstile(form);}catch{}
  }
  function initAnalytics(config){
    const banner=document.getElementById('analyticsConsent');
    if(!config.gaMeasurementId||!banner)return;
    const key='menuza-analytics-consent-v1';
    const load=()=>{
      if(window.__menuzaGaLoaded)return;
      window.__menuzaGaLoaded=true;
      window.dataLayer=window.dataLayer||[];
      function gtag(){window.dataLayer.push(arguments);}
      window.gtag=gtag;gtag('consent','default',{analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
      gtag('js',new Date());gtag('config',config.gaMeasurementId,{send_page_view:true,anonymize_ip:true});
      const script=document.createElement('script');script.async=true;script.src='https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(config.gaMeasurementId);document.head.appendChild(script);
    };
    let choice='';try{choice=localStorage.getItem(key)||'';}catch{}
    if(choice==='granted')load();else if(choice!=='denied')banner.hidden=false;
    banner.addEventListener('click',event=>{
      const button=event.target.closest('[data-analytics-consent]');if(!button)return;
      const value=button.dataset.analyticsConsent;
      if(value!=='granted'&&value!=='denied')return;
      try{localStorage.setItem(key,value);}catch{}
      banner.hidden=true;
      if(value==='granted')load();
    });
  }
  configPromise.then(config=>{
    initAnalytics(config||{});
    document.querySelectorAll('form#adminLogin,form#customerAuthForm').forEach(initForm);
    const observer=new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{
      if(node.nodeType!==1)return;
      if(node.matches?.('form#adminLogin,form#customerAuthForm'))initForm(node);
      node.querySelectorAll?.('form#adminLogin,form#customerAuthForm').forEach(initForm);
    })));
    observer.observe(document.documentElement,{childList:true,subtree:true});
  });
  window.MenuzaIntegrations={getTurnstileToken};
})();
