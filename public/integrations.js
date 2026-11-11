// Integrações do Menuza: Google Tag Manager com Consent Mode e Cloudflare Turnstile.
(function(){
  const configPromise=fetch('/api/dispatch?path=public/integrations',{headers:{Accept:'application/json'},credentials:'same-origin'}).then(r=>r.ok?r.json():{}).catch(()=>({}));
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
    if(!config.turnstileSiteKey||!form?.isConnected||!window.turnstile)return;
    const holder=form.querySelector('[data-turnstile]');
    if(!holder||holder.dataset.widgetId)return;
    let hidden=form.querySelector('input[name="turnstileToken"]');
    if(!hidden){
      hidden=document.createElement('input');
      hidden.type='hidden';
      hidden.name='turnstileToken';
      form.appendChild(hidden);
    }
    try{
      const id=window.turnstile.render(holder,{
        sitekey:config.turnstileSiteKey,
        theme:'auto',
        callback:token=>{if(hidden.isConnected)hidden.value=token;},
        'expired-callback':()=>{if(hidden.isConnected)hidden.value='';},
        'error-callback':()=>{if(hidden.isConnected)hidden.value='';}
      });
      holder.dataset.widgetId=String(id);
    }catch{}
  }
  async function getTurnstileToken(form){
    const config=await configPromise;
    if(!config.turnstileSiteKey)return '';
    try{
      await loadTurnstile();
      await mountTurnstile(form);
      const hidden=form?.querySelector('input[name="turnstileToken"]');
      // O callback oficial mantém o token atualizado. Evitamos consultar o widget
      // por um ID que pode ter ficado obsoleto após a recriação do formulário.
      const token=hidden?.value||'';
      if(!token)throw new Error('Conclua a verificação antirrobô antes de continuar.');
      return token;
    }catch(error){throw new Error(error?.message||'Não foi possível carregar a verificação de segurança. Atualize a página.');}
  }
  async function initForm(form){
    const config=await configPromise;
    if(!config.turnstileSiteKey||!form?.querySelector('[data-turnstile]'))return;
    try{await loadTurnstile();await mountTurnstile(form);}catch{}
  }
  function initAnalytics(){
    const banner=document.getElementById('analyticsConsent');
    if(!banner)return;
    const key='menuza-analytics-consent-v1';
    const containerId='GTM-WG6783J6';
    const setConsent=value=>{
      if(typeof window.gtag==='function')window.gtag('consent','update',{
        analytics_storage:value,
        ad_storage:'denied',
        ad_user_data:'denied',
        ad_personalization:'denied'
      });
    };
    const load=()=>{
      if(window.__menuzaGtmLoaded){setConsent('granted');return;}
      window.__menuzaGtmLoaded=true;
      window.dataLayer=window.dataLayer||[];
      window.gtag=function(){window.dataLayer.push(arguments);};
      window.gtag('consent','default',{
        analytics_storage:'denied',
        ad_storage:'denied',
        ad_user_data:'denied',
        ad_personalization:'denied'
      });
      window.gtag('consent','update',{analytics_storage:'granted'});
      window.gtag('js',new Date());
      const script=document.createElement('script');
      script.async=true;
      script.src='https://www.googletagmanager.com/gtm.js?id='+encodeURIComponent(containerId);
      document.head.appendChild(script);
    };
    let choice='';try{choice=localStorage.getItem(key)||'';}catch{}
    if(choice==='granted')load();else if(choice!=='denied')banner.hidden=false;
    document.addEventListener('click',event=>{
      if(event.target.closest('[data-analytics-manage]')){
        event.preventDefault();
        banner.hidden=false;
      }
    });
    banner.addEventListener('click',event=>{
      const button=event.target.closest('[data-analytics-consent]');
      if(!button)return;
      const value=button.dataset.analyticsConsent;
      if(value!=='granted'&&value!=='denied')return;
      try{localStorage.setItem(key,value);}catch{}
      banner.hidden=true;
      if(value==='granted')load();else setConsent('denied');
    });
  }
  configPromise.then(config=>{
    initAnalytics();
    document.querySelectorAll('form#adminLogin,form#customerAuthForm').forEach(initForm);
    const observer=new MutationObserver(records=>records.forEach(record=>{
      record.removedNodes.forEach(node=>{
        if(node.nodeType!==1)return;
        const holders=[];
        if(node.matches?.('[data-turnstile]'))holders.push(node);
        node.querySelectorAll?.('[data-turnstile]').forEach(holder=>holders.push(holder));
        holders.forEach(holder=>{
          if(holder.isConnected)return;
          const widgetId=holder.dataset.widgetId;
          if(widgetId&&window.turnstile?.remove){
            try{window.turnstile.remove(widgetId);}catch{}
            delete holder.dataset.widgetId;
          }
        });
      });
      record.addedNodes.forEach(node=>{
        if(node.nodeType!==1)return;
        if(node.matches?.('form#adminLogin,form#customerAuthForm'))initForm(node);
        node.querySelectorAll?.('form#adminLogin,form#customerAuthForm').forEach(initForm);
      });
    }));
    observer.observe(document.documentElement,{childList:true,subtree:true});
  });
  window.MenuzaIntegrations={getTurnstileToken};
})();
