// Google Tag Manager bootstrap with Consent Mode defaults.
// Served as a same-origin file so the site's CSP does not block inline JavaScript.
(function(w,d,s,l,i){
  w[l]=w[l]||[];
  w.gtag=w.gtag||function(){w[l].push(arguments);};
  w.gtag('consent','default',{
    analytics_storage:'denied',
    ad_storage:'denied',
    ad_user_data:'denied',
    ad_personalization:'denied',
    functionality_storage:'granted',
    security_storage:'granted',
    wait_for_update:500
  });
  w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});
  var first=d.getElementsByTagName(s)[0],script=d.createElement(s),dl=l!=='dataLayer'?'&l='+l:'';
  script.async=true;
  script.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;
  first.parentNode.insertBefore(script,first);
})(window,document,'script','dataLayer','GTM-WG6783J6');
