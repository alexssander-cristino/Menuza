/* Progressive motion enhancement for Menuza. Core ordering and checkout do not depend on CDNs. */
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mobile = matchMedia('(max-width: 760px)').matches;
  const load = url => import(url).catch(error => { console.warn('[Menuza motion] optional module unavailable', error); return null; });
  async function motionUI() {
    const m = await load('https://cdn.jsdelivr.net/npm/motion@12.23.24/+esm');
    if (!m?.animate) return;
    if (!reduced && m.inView) m.inView('.hero-stamp', el => m.animate(el, { opacity: [0,1], filter: ['blur(4px)','blur(0px)'] }, { duration: .45, ease: 'easeOut' }));
    if (reduced) return;
    document.addEventListener('pointerover', e => { const el=e.target.closest('.button,.cart-button,.favorite-toggle,.add-button'); if(el&&!el.contains(e.relatedTarget))m.animate(el,{filter:['brightness(1)','brightness(1.07)']},{duration:.16}); },{passive:true});
    document.addEventListener('pointerout', e => { const el=e.target.closest('.button,.cart-button,.favorite-toggle,.add-button'); if(el&&!el.contains(e.relatedTarget))m.animate(el,{filter:['brightness(1.07)','brightness(1)']},{duration:.18}); },{passive:true});
  }
  async function animeUI() {
    if(reduced)return;
    const a=await load('https://cdn.jsdelivr.net/npm/animejs@4.2.2/+esm');
    if(!a?.animate)return;
    const steps=document.querySelectorAll('.hero-steps li');
    if(steps.length)a.animate(steps,{opacity:[0,1],y:[14,0],delay:a.stagger?a.stagger(75):0,duration:560,ease:'out(3)'});
    const categories=document.getElementById('categoryList');
    if(categories&&window.MutationObserver){let old='';const reveal=()=>{const nodes=[...categories.querySelectorAll('.category-chip')],sig=nodes.map(n=>n.textContent).join('|');if(!nodes.length||sig===old)return;old=sig;a.animate(nodes,{opacity:[.72,1],scale:[.97,1],delay:a.stagger?a.stagger(28):0,duration:300,ease:'out(3)'});};new MutationObserver(reveal).observe(categories,{childList:true});reveal();}
  }
  async function gsapUI() {
    if(reduced||mobile)return;
    const [c,p]=await Promise.all([load('https://cdn.jsdelivr.net/npm/gsap@3.13.0/+esm'),load('https://cdn.jsdelivr.net/npm/gsap@3.13.0/ScrollTrigger/+esm')]);
    const gsap=c?.gsap||c?.default?.gsap||c?.default, st=p?.ScrollTrigger||p?.default?.ScrollTrigger||p?.default, circle=document.querySelector('.craft-circle');
    if(!gsap||!st||!circle)return;gsap.registerPlugin(st);
    gsap.to(circle,{rotation:28,ease:'none',scrollTrigger:{trigger:'#sobre',start:'top bottom',end:'bottom top',scrub:.8}});
    const card=document.querySelector('.craft-copy-card');if(card)gsap.fromTo(card,{y:16,rotation:-9},{y:0,rotation:-5,ease:'none',scrollTrigger:{trigger:'#sobre',start:'top 88%',end:'center center',scrub:.6}});
  }
  async function threeUI() {
    if(reduced||mobile||!('WebGLRenderingContext'in window))return;
    const host=document.querySelector('.hero-art-wrap');if(!host)return;
    const T=await load('https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js');if(!T?.WebGLRenderer)return;
    let renderer;
    try {
      const canvas=document.createElement('canvas');canvas.className='hero-three-canvas';canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3;opacity:.9';canvas.setAttribute('aria-hidden','true');
      renderer=new T.WebGLRenderer({canvas,alpha:true,antialias:false,powerPreference:'low-power'});renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.35));renderer.setClearColor(0,0);host.prepend(canvas);
      const scene=new T.Scene(),camera=new T.PerspectiveCamera(36,1,.1,30);camera.position.z=6.4;scene.add(new T.AmbientLight(0xffffff,2));
      const light=new T.DirectionalLight(0xffffff,2.2);light.position.set(-3,4,5);scene.add(light);const group=new T.Group();scene.add(group);
      const colors=[0x7965d8,0xe3a15b,0x6d8d58,0xd77b66,0xb6a7e9,0xd7c2a0],pts=[[-1.72,.95,0,.105],[1.72,.84,.05,.12],[-1.78,-.52,.1,.075],[1.76,-.7,.05,.09],[-1.25,-1.12,-.2,.06],[1.2,1.18,-.15,.065]],geo=new T.IcosahedronGeometry(1,1);
      pts.forEach((p,i)=>{const mesh=new T.Mesh(geo,new T.MeshStandardMaterial({color:colors[i],roughness:.42,metalness:.08,transparent:true,opacity:.88}));mesh.position.set(p[0],p[1],p[2]);mesh.scale.setScalar(p[3]);group.add(mesh);});
      const ring=new T.Mesh(new T.TorusGeometry(.23,.012,5,36),new T.MeshStandardMaterial({color:0x8d7be2,roughness:.5,transparent:true,opacity:.72}));ring.position.set(1.43,.16,-.1);ring.rotation.set(.85,.25,-.4);group.add(ring);
      const resize=()=>{const w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();};resize();
      const ro='ResizeObserver'in window?new ResizeObserver(resize):null;ro?.observe(host);let visible=false,raf=0,last=0;
      const stop=()=>{visible=false;if(raf)cancelAnimationFrame(raf);raf=0;},render=now=>{raf=0;if(!visible||document.hidden)return;if(now-last>32){group.rotation.y=Math.sin(now*.00022)*.09;group.rotation.x=Math.cos(now*.00018)*.035;renderer.render(scene,camera);last=now;}raf=requestAnimationFrame(render);},start=()=>{visible=true;if(!raf)raf=requestAnimationFrame(render);};
      if('IntersectionObserver'in window)new IntersectionObserver(entries=>entries.forEach(e=>e.isIntersecting?start():stop()),{threshold:.01}).observe(host);else start();
      document.addEventListener('visibilitychange',()=>document.hidden?stop():start());
      window.addEventListener('pagehide',()=>{stop();ro?.disconnect();geo.dispose();ring.geometry.dispose();group.children.forEach(x=>x.material?.dispose());renderer.dispose();},{once:true});
    }catch(error){renderer?.dispose();host.querySelector('.hero-three-canvas')?.remove();console.warn('[Menuza motion] decorative scene disabled',error);}
  }
  motionUI();animeUI();gsapUI();threeUI();
})();
