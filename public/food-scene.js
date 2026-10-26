const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hash = value => { let h = 2166136261; for (const c of String(value)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const randomFor = seed => { let n = seed >>> 0; return () => { n = (Math.imul(1664525, n) + 1013904223) >>> 0; return n / 4294967296; }; };
const hex = value => { const n = parseInt(value.replace('#', ''), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

function normalize(a) { const d = Math.hypot(a[0], a[1], a[2]) || 1; return a.map(v => v / d); }
function sub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }

class MeshBuilder {
  constructor() { this.positions = []; this.normals = []; this.colors = []; }
  triangle(a, b, c, colorA, colorB = colorA, colorC = colorA) {
    const normal = normalize(cross(sub(b, a), sub(c, a)));
    for (const [point, color] of [[a,colorA],[b,colorB],[c,colorC]]) {
      this.positions.push(point[0], point[1], point[2]);
      this.normals.push(normal[0], normal[1], normal[2]);
      this.colors.push(color[0], color[1], color[2]);
    }
  }
  quad(a, b, c, d, colorA, colorB = colorA, colorC = colorA, colorD = colorA) {
    this.triangle(a, b, c, colorA, colorB, colorC);
    this.triangle(a, c, d, colorA, colorC, colorD);
  }
  sphere(cx, cy, cz, rx, ry, rz, color, seed = 0, detail = 16) {
    const rings = Math.max(8, Math.floor(detail / 1.5)), segments = detail;
    const point = (u, v) => {
      const py = Math.cos(u * Math.PI), r = Math.sin(u * Math.PI), angle = v * TAU;
      const wobble = 1 + Math.sin(u * 79 + v * 113 + seed) * .004 + Math.sin(u * 121 - v * 51 + seed) * .002;
      return [cx + Math.cos(angle) * r * rx * wobble, cy + py * ry * wobble, cz + Math.sin(angle) * r * rz * wobble];
    };
    for (let i = 0; i < rings; i++) for (let j = 0; j < segments; j++) {
      const p1=point(i/rings,j/segments), p2=point((i+1)/rings,j/segments), p3=point((i+1)/rings,(j+1)/segments), p4=point(i/rings,(j+1)/segments);
      const tint = (i+j)%3===0 ? .97 : 1.015, color2=color.map(v=>clamp(v*tint,0,1));
      this.quad(p1,p2,p3,p4,color,color2,color2,color);
    }
  }
  cylinder(cx, cz, bottom, top, rx, rz, color, seed = 1, irregular = 0) {
    const segments = 48, rnd = randomFor(seed), lower = [], upper = [];
    for(let i=0;i<=segments;i++){
      const a=i/segments*TAU, wave=1+irregular*(Math.sin(a*7+seed)*.55+Math.sin(a*13+seed*.31)*.28+(rnd()-.5)*.2);
      const x=Math.cos(a)*rx*wave,z=Math.sin(a)*rz*wave;
      lower.push([cx+x,bottom,cz+z]); upper.push([cx+x,top,cz+z]);
    }
    const dark=color.map(v=>v*.78), light=color.map(v=>clamp(v*1.04,0,1)), center=[cx,top,cz], bottomCenter=[cx,bottom,cz];
    for(let i=0;i<segments;i++){
      this.quad(lower[i],lower[i+1],upper[i+1],upper[i],dark,color,color,dark);
      this.triangle(center,upper[i],upper[i+1],light,color,color);
      this.triangle(bottomCenter,lower[i+1],lower[i],dark,dark,dark);
    }
  }
  ring(cx, cz, y, radius, tube, color, seed = 1) {
    const major=32, minor=8;
    const point=(u,v)=>{
      const a=u*TAU,b=v*TAU, wobble=1+Math.sin(a*5+seed)*.035;
      const r=radius*wobble+tube*Math.cos(b);
      return [cx+Math.cos(a)*r,y+tube*Math.sin(b),cz+Math.sin(a)*r];
    };
    for(let i=0;i<major;i++)for(let j=0;j<minor;j++){
      this.quad(point(i/major,j/minor),point((i+1)/major,j/minor),point((i+1)/major,(j+1)/minor),point(i/major,(j+1)/minor),color);
    }
  }
  strip(cx, cz, y, length, width, thickness, angle, color, seed=1) {
    const c=Math.cos(angle),s=Math.sin(angle),parts=10;
    for(let i=0;i<parts;i++){
      const t1=i/parts-.5,t2=(i+1)/parts-.5;
      const wiggle=t=>Math.sin((t+.5)*Math.PI*3+seed)*width*.18;
      const pt=(t,side,up)=>[cx+c*(t*length)-s*(side*width+wiggle(t)),y+up*thickness,cz+s*(t*length)+c*(side*width+wiggle(t))];
      const col=i%3===0?color.map(v=>clamp(v*1.08,0,1)):color;
      this.quad(pt(t1,-.5,0),pt(t2,-.5,0),pt(t2,.5,0),pt(t1,.5,0),col);
      this.quad(pt(t1,-.5,0),pt(t1,.5,0),pt(t1,.5,1),pt(t1,-.5,1),color);
      this.quad(pt(t1,-.5,1),pt(t1,.5,1),pt(t2,.5,1),pt(t2,-.5,1),col);
    }
  }
  data() { return { positions:new Float32Array(this.positions), normals:new Float32Array(this.normals), colors:new Float32Array(this.colors) }; }
}

const COLORS = {
  crust:hex('#c9894c'), crustLight:hex('#e5b66f'), sauce:hex('#b84430'), cheese:hex('#f0d078'),
  pepperoni:hex('#a94332'), bacon:hex('#a64635'), meat:hex('#5a382b'), bun:hex('#d99a51'),
  lettuce:hex('#71924d'), tomato:hex('#d7654a'), onion:hex('#b4768d'), corn:hex('#e4bd55'),
  olive:hex('#394a32'), mushroom:hex('#d5c7a6'), cream:hex('#f3e5bf'), herb:hex('#69804c'),
  cheddar:hex('#e3a938'), egg:hex('#fff0ce'), pickle:hex('#789149'), plate:hex('#f0eee2'),
  potato:hex('#c4873e'), shadow:hex('#9da99a')
};

function pizzaGeometry(product, ingredients, size) {
  const g=new MeshBuilder(), width=(size?.diameterCm || product.widthCm || 30)/100, depth=size?.diameterCm ? size.diameterCm/100 : (product.depthCm || width*100)/100;
  const radiusX=width/2,radiusZ=depth/2,height=(Number(product.heightCm)||2)/100;
  const base=height*.78, top=height;
  g.cylinder(0,0,0,base,radiusX,radiusZ,COLORS.crust,hash(product.id),.025);
  g.cylinder(0,0,base*.72,base*.8,radiusX*.87,radiusZ*.87,COLORS.crustLight,21,.01);
  const ids=new Set(ingredients.map(x=>x.id));
  if(ids.has('molho-tomate'))g.cylinder(0,0,base*.82,base*.88,radiusX*.84,radiusZ*.84,COLORS.sauce,22,.015);
  if(ids.has('mussarela'))g.cylinder(0,0,base*.88,top*.91,radiusX*.82,radiusZ*.82,COLORS.cheese,23,.018);
  const toppingDefs={
    calabresa:['pepperoni',COLORS.pepperoni], bacon:['bacon',COLORS.bacon], frango:['chicken',hex('#d1a66d')],
    cebola:['onion',COLORS.onion], tomate:['tomato',COLORS.tomato], milho:['corn',COLORS.corn],
    azeitona:['olive',COLORS.olive], champignon:['mushroom',COLORS.mushroom], requeijao:['cream',COLORS.cream], oregano:['herb',COLORS.herb]
  };
  for(const item of ingredients){
    const def=toppingDefs[item.id];if(!def||['molho-tomate','mussarela'].includes(item.id))continue;
    const [kind,color]=def, quantity=clamp(Number(item.quantity)||1,1,3), rnd=randomFor(hash(product.id+item.id));
    const count=kind==='herb'?quantity*19:kind==='corn'?quantity*13:quantity*5;
    for(let n=0;n<count;n++){
      const angle=rnd()*TAU, radial=Math.sqrt(rnd())*.72, x=Math.cos(angle)*radiusX*radial,z=Math.sin(angle)*radiusZ*radial,y=top*.92+rnd()*height*.035;
      const scale=.017+Math.min(radiusX,radiusZ)*(.045+rnd()*.045), seed=hash(item.id+n);
      if(kind==='pepperoni'){
        const r=scale*1.15;g.cylinder(x,z,y,y+height*.055,r,r*.82,color,seed,.06);
        g.sphere(x-r*.27,y+height*.055,z-r*.17,r*.13,height*.012,r*.11,COLORS.crustLight,seed+2,8);
        g.sphere(x+r*.28,y+height*.055,z+r*.18,r*.11,height*.012,r*.09,COLORS.crustLight,seed+3,8);
      } else if(kind==='bacon') g.strip(x,z,y,scale*3,scale*.7,height*.035,rnd()*Math.PI,color,seed);
      else if(kind==='chicken') g.sphere(x,y+height*.035,z,scale,scale*.56,scale*.8,color,seed,12);
      else if(kind==='onion') g.ring(x,z,y,scale*.9,scale*.23,color,seed);
      else if(kind==='tomato'){
        g.cylinder(x,z,y,y+height*.035,scale,scale*.76,color,seed,.045);
        g.sphere(x,y+height*.036,z,scale*.14,height*.008,scale*.12,COLORS.cream,seed+1,8);
      } else if(kind==='corn') g.sphere(x,y+height*.035,z,scale*.34,height*.028,scale*.28,color,seed,9);
      else if(kind==='olive') g.sphere(x,y+height*.04,z,scale*.72,height*.04,scale*.62,color,seed,12);
      else if(kind==='mushroom'){
        g.sphere(x,y+height*.04,z,scale, height*.035,scale*.72,color,seed,12);
        g.cylinder(x,z,y,y+height*.045,scale*.25,scale*.25,COLORS.cream,seed+1);
      } else if(kind==='cream') g.strip(x,z,y,scale*2.5,scale*.38,height*.045,rnd()*Math.PI,color,seed);
      else g.strip(x,z,y,scale*1.5,scale*.16,height*.018,rnd()*Math.PI,color,seed);
    }
  }
  return {geometry:g.data(), bounds:[width,height,depth], type:'pizza'};
}
function burgerGeometry(product, ingredients, size) {
  const g=new MeshBuilder(),width=(Number(product.widthCm)||12)/100,depth=(Number(product.depthCm)||12)/100,height=(Number(product.heightCm)||10)/100;
  const sx=width/2,sz=depth/2, ids=new Map(ingredients.map(item=>[item.id,clamp(Number(item.quantity)||1,1,3)]));
  const has=id=>ids.has(id), qty=id=>ids.get(id)||0, baseY=height*.045, bunH=height*.22;
  g.sphere(0,baseY+bunH*.42,0,sx*.91,bunH*.54,sz*.91,COLORS.bun,hash(product.id+'bottom'),24);
  let y=height*.28;
  const layerHeight=height*.055;
  if(has('molho-especial')){g.cylinder(0,0,y,y+layerHeight*.55,sx*.79,sz*.79,COLORS.cream,11,.04);y+=layerHeight*.65;}
  if(has('alface')){
    const count=qty('alface')*9;
    for(let i=0;i<count;i++){const a=i/count*TAU,r=.84, cx=Math.cos(a)*sx*r,cz=Math.sin(a)*sz*r;g.sphere(cx,y,cz,sx*.25,layerHeight*.42,sz*.22,COLORS.lettuce,i+1,12);}
    g.cylinder(0,0,y-layerHeight*.15,y+layerHeight*.12,sx*.8,sz*.8,COLORS.lettuce,17,.10);y+=layerHeight*.75;
  }
  if(has('tomate-burger')){
    for(let i=0;i<Math.max(2,qty('tomate-burger')*2);i++){const a=i*TAU/Math.max(2,qty('tomate-burger')*2),r=.34;g.cylinder(Math.cos(a)*sx*r,Math.sin(a)*sz*r,y,y+layerHeight*.6,sx*.34,sz*.34,COLORS.tomato,i+30,.04);}
    y+=layerHeight*.65;
  }
  if(has('cebola-burger')){g.ring(0,0,y+layerHeight*.12,sx*.57,Math.min(sx,sz)*.08,COLORS.onion,9);y+=layerHeight*.35;}
  if(has('picles')){for(let i=0;i<qty('picles')+1;i++){const a=i*2.4;g.sphere(Math.cos(a)*sx*.44,y,Math.sin(a)*sz*.44,sx*.2,layerHeight*.2,sz*.13,COLORS.pickle,i+1,12);}y+=layerHeight*.25;}
  if(has('carne')){
    const patties=size?.key==='duplo'?2:1,pattyH=height*(patties===2?.12:.19),pattyGap=height*.035;
    for(let patty=0;patty<patties;patty++){const py=y+patty*(pattyH+pattyGap);g.cylinder(0,0,py,py+pattyH,sx*.83,sz*.83,COLORS.meat,39+patty,.075);for(let i=0;i<22;i++){const rnd=randomFor(i+77+patty*113),a=rnd()*TAU,r=Math.sqrt(rnd())*.72;g.sphere(Math.cos(a)*sx*r,py+pattyH*.98,Math.sin(a)*sz*r,sx*.035,pattyH*.035,sz*.035,hex(i%2?'#a9754d':'#76503a'),i+1+patty*22,8);}}
    y+=pattyH*patties+pattyGap*(patties-1);
  }
  const cheeseQty=qty('queijo-cheddar')+qty('queijo-extra');
  if(cheeseQty){for(let n=0;n<Math.min(3,cheeseQty);n++){g.cylinder(0,0,y+height*.008,y+height*.027,sx*.9,sz*.9,COLORS.cheddar,63+n,.10);y+=height*.03;}}
  if(has('bacon-burger')){
    const count=qty('bacon-burger')*2;
    for(let i=0;i<count;i++){const a=i*TAU/count,ox=Math.cos(a)*sx*.22,oz=Math.sin(a)*sz*.22;g.strip(ox,oz,y+height*.012,sx*1.1,sz*.18,height*.035,a,COLORS.bacon,i+1);}
    y+=height*.06;
  }
  if(has('ovo')){g.sphere(0,y+height*.028,0,sx*.55,height*.04,sz*.52,COLORS.egg,71,20);g.sphere(sx*.1,y+height*.065,0,sx*.14,height*.012,sz*.14,hex('#e2a345'),72,14);y+=height*.06;}
  const topCenter=height*.83;
  g.sphere(0,topCenter,0,sx*.95,height*.17,sz*.95,COLORS.bun,hash(product.id+'top'),28);
  const rnd=randomFor(hash(product.id+'sesame'));
  for(let i=0;i<19;i++){const a=rnd()*TAU,r=Math.sqrt(rnd())*.7;g.sphere(Math.cos(a)*sx*r,topCenter+height*.15,Math.sin(a)*sz*r,sx*.035,height*.012,sz*.018,COLORS.cream,i+1,8);}
  return {geometry:g.data(),bounds:[width,height,depth],type:'burger'};
}
function plateGeometry(product) {
  const g=new MeshBuilder(),width=(Number(product.widthCm)||20)/100,depth=(Number(product.depthCm)||20)/100,height=(Number(product.heightCm)||4)/100,sx=width/2,sz=depth/2;
  g.cylinder(0,0,0,height*.20,sx,sz,COLORS.plate,1,.025);
  g.cylinder(0,0,height*.20,height*.23,sx*.78,sz*.78,hex('#ddd9c9'),2,.01);
  const rnd=randomFor(9173);
  for(let i=0;i<9;i++){
    const angle=i*2.34,r=.3+rnd()*.18,x=Math.cos(angle)*sx*r,z=Math.sin(angle)*sz*r;
    g.sphere(x,height*.43,z,sx*.09,height*.22,sz*.27,COLORS.potato,i+1,14);
    g.strip(x,z,height*.59,sx*.12,sz*.045,height*.025,angle,hex('#e2b16d'),i+30);
  }
  for(let i=0;i<7;i++){const a=rnd()*TAU,r=rnd()*.3;g.sphere(Math.cos(a)*sx*r,height*.45,Math.sin(a)*sz*r,sx*.025,height*.025,sz*.025,COLORS.herb,i+40,8);}
  return {geometry:g.data(),bounds:[width,height,depth],type:'plate'};
}
export function buildFoodGeometry(product, ingredients, size) {
  if(product.type==='pizza')return pizzaGeometry(product,ingredients,size);
  if(product.type==='burger')return burgerGeometry(product,ingredients,size);
  return plateGeometry(product);
}

function mat4Identity(){return new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);}
function mat4Multiply(a,b){const o=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)o[c*4+r]=a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3];return o;}
function mat4Perspective(fovy,aspect,near,far){const f=1/Math.tan(fovy/2),nf=1/(near-far),o=new Float32Array(16);o[0]=f/aspect;o[5]=f;o[10]=(far+near)*nf;o[11]=-1;o[14]=2*far*near*nf;return o;}
function mat4LookAt(eye,center,up){const z=normalize(sub(eye,center)),x=normalize(cross(up,z)),y=cross(z,x),o=mat4Identity();o[0]=x[0];o[1]=y[0];o[2]=z[0];o[4]=x[1];o[5]=y[1];o[6]=z[1];o[8]=x[2];o[9]=y[2];o[10]=z[2];o[12]=-x[0]*eye[0]-x[1]*eye[1]-x[2]*eye[2];o[13]=-y[0]*eye[0]-y[1]*eye[1]-y[2]*eye[2];o[14]=-z[0]*eye[0]-z[1]*eye[1]-z[2]*eye[2];return o;}
function mat4Translate(x,y,z){const m=mat4Identity();m[12]=x;m[13]=y;m[14]=z;return m;}
function mat4Scale(x,y,z){const m=mat4Identity();m[0]=x;m[5]=y;m[10]=z;return m;}
function mat4RotateY(angle){const c=Math.cos(angle),s=Math.sin(angle);return new Float32Array([c,0,-s,0,0,1,0,0,s,0,c,0,0,0,0,1]);}

export class FoodScene {
  constructor(canvas, product, ingredients, size, hud) {
    this.canvas=canvas;this.hud=hud;this.angle=0;this.zoom=1;this.session=null;this.hitSource=null;this.referenceSpace=null;this.reticle=null;this.modelMatrix=mat4Identity();this.arPlaced=false;this.xrEnding=false;
    this.gl=canvas.getContext('webgl2',{alpha:true,antialias:true,preserveDrawingBuffer:false})||canvas.getContext('webgl',{alpha:true,antialias:true,preserveDrawingBuffer:false});
    if(!this.gl)throw new Error('Este navegador não oferece WebGL para a prévia 3D.');
    this.webgl2=typeof WebGL2RenderingContext!=='undefined'&&this.gl instanceof WebGL2RenderingContext;this.program=this.makeProgram();this.locations={position:this.gl.getAttribLocation(this.program,'aPosition'),normal:this.gl.getAttribLocation(this.program,'aNormal'),color:this.gl.getAttribLocation(this.program,'aColor'),projection:this.gl.getUniformLocation(this.program,'uProjection'),view:this.gl.getUniformLocation(this.program,'uView'),model:this.gl.getUniformLocation(this.program,'uModel')};
    this.buffers={position:this.gl.createBuffer(),normal:this.gl.createBuffer(),color:this.gl.createBuffer()};this.update(product,ingredients,size);this.resizeObserver=new ResizeObserver(()=>this.render());this.resizeObserver.observe(canvas);this.render();
  }
  makeProgram(){
    const gl=this.gl,compile=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader)||'Erro ao preparar o visualizador 3D.');return shader;};
    const vsSource=this.webgl2?'#version 300 es\nin vec3 aPosition;in vec3 aNormal;in vec3 aColor;uniform mat4 uProjection;uniform mat4 uView;uniform mat4 uModel;out vec3 vColor;out vec3 vNormal;void main(){vec4 world=uModel*vec4(aPosition,1.0);vNormal=mat3(uModel)*aNormal;vColor=aColor;gl_Position=uProjection*uView*world;}':'attribute vec3 aPosition;attribute vec3 aNormal;attribute vec3 aColor;uniform mat4 uProjection;uniform mat4 uView;uniform mat4 uModel;varying vec3 vColor;varying vec3 vNormal;void main(){vec4 world=uModel*vec4(aPosition,1.0);vNormal=mat3(uModel)*aNormal;vColor=aColor;gl_Position=uProjection*uView*world;}';
    const fsSource=this.webgl2?'#version 300 es\nprecision highp float;in vec3 vColor;in vec3 vNormal;out vec4 outColor;void main(){vec3 n=normalize(gl_FrontFacing?vNormal:-vNormal);vec3 light=normalize(vec3(-0.35,0.82,0.42));float diffuse=max(dot(n,light),0.0);vec3 color=vColor*(0.56+0.52*diffuse);float sheen=pow(max(dot(reflect(-light,n),normalize(vec3(0.2,0.6,1.0))),0.0),18.0)*0.08;outColor=vec4(color+sheen,1.0);}':'precision highp float;varying vec3 vColor;varying vec3 vNormal;void main(){vec3 n=normalize(gl_FrontFacing?vNormal:-vNormal);vec3 light=normalize(vec3(-0.35,0.82,0.42));float diffuse=max(dot(n,light),0.0);vec3 color=vColor*(0.56+0.52*diffuse);float sheen=pow(max(dot(reflect(-light,n),normalize(vec3(0.2,0.6,1.0))),0.0),18.0)*0.08;gl_FragColor=vec4(color+sheen,1.0);}';
    const vs=compile(gl.VERTEX_SHADER,vsSource),fs=compile(gl.FRAGMENT_SHADER,fsSource);
    const program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)||'Erro ao iniciar o visualizador 3D.');return program;
  }
  update(product,ingredients,size){
    this.product=product;this.ingredients=ingredients;this.size=size;this.model=buildFoodGeometry(product,ingredients,size);
    this.upload(this.buffers.position,this.locations.position,this.model.geometry.positions,3);
    this.upload(this.buffers.normal,this.locations.normal,this.model.geometry.normals,3);
    this.upload(this.buffers.color,this.locations.color,this.model.geometry.colors,3);
    this.vertexCount=this.model.geometry.positions.length/3;this.render();
  }
  upload(buffer,location,data,size){const gl=this.gl;gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,0,0);}
  setAngle(angle){this.angle=angle;this.render();}
  setZoom(zoom){this.zoom=zoom;this.render();}
  render(){
    if(!this.gl||this.session||!this.canvas.isConnected)return;
    const gl=this.gl,dpr=Math.min(window.devicePixelRatio||1,2),w=Math.max(1,Math.round(this.canvas.clientWidth*dpr)),h=Math.max(1,Math.round(this.canvas.clientHeight*dpr));
    if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
    gl.viewport(0,0,w,h);gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(this.program);
    const [width,height,depth]=this.model.bounds,max=Math.max(width,height,depth),distance=Math.max(.35,max*(this.model.type==='pizza'||this.model.type==='plate'?1.32:2.1))/this.zoom;const eyeY=max*(this.model.type==='pizza'||this.model.type==='plate'?1.02:.5);
    const aspect=w/h,projection=mat4Perspective(Math.PI/4,aspect,.01,100),view=mat4LookAt([0,eyeY,distance],[0,0,0],[0,1,0]);
    const model=mat4Multiply(mat4Translate(0,-height*.5,0),mat4RotateY(this.angle));
    gl.uniformMatrix4fv(this.locations.projection,false,projection);gl.uniformMatrix4fv(this.locations.view,false,view);gl.uniformMatrix4fv(this.locations.model,false,model);gl.drawArrays(gl.TRIANGLES,0,this.vertexCount);
  }
  async supportsAR(){
    try{return Boolean(navigator.xr&&await navigator.xr.isSessionSupported('immersive-ar'));}catch{return false;}
  }
  async enterAR(){
    if(!navigator.xr)throw new Error('Este navegador não oferece WebXR. Use a prévia 3D interativa.');
    const session=await navigator.xr.requestSession('immersive-ar',{requiredFeatures:['hit-test'],optionalFeatures:['dom-overlay'],domOverlay:{root:this.hud}});
    this.session=session;this.arPlaced=false;
    try{
      this.canvas.classList.add('ar-hidden-canvas');this.hud?.classList.add('ar-active');if(this.hud)this.hud.innerHTML='<strong>Mova o telefone para localizar uma superfície</strong><span>Quando ela for detectada, toque para posicionar o prato em escala real.</span><button type="button" data-action="exit-ar">Voltar ao menu</button>';
      await this.gl.makeXRCompatible();
      const layer=new XRWebGLLayer(session,this.gl,{alpha:true,depth:true,antialias:true});session.updateRenderState({baseLayer:layer});
      this.referenceSpace=await session.requestReferenceSpace('local');
      const viewerSpace=await session.requestReferenceSpace('viewer');
      this.hitSource=await session.requestHitTestSource({space:viewerSpace});
      this.modelMatrix=mat4Identity();
      session.addEventListener('select',()=>{if(this.reticle){this.arPlaced=true;if(this.hud)this.hud.innerHTML='<strong>Prato posicionado em escala real</strong><span>Você pode observar o modelo ao redor.</span><button type="button" data-action="exit-ar">Voltar ao menu</button>';if(this.hud)delete this.hud.dataset.surface;}});
      session.addEventListener('end',()=>this.endAR(),{once:true});
      session.requestAnimationFrame((time,frame)=>this.onXRFrame(time,frame));
    }catch(error){
      this.session=null;this.hitSource?.cancel?.();this.hitSource=null;this.canvas.classList.remove('ar-hidden-canvas');this.hud?.classList.remove('ar-active');if(this.hud)this.hud.innerHTML='';
      try{await session.end();}catch{}
      throw error;
    }
  }
  onXRFrame(time,frame){
    const session=frame.session;if(this.session!==session)return;
    session.requestAnimationFrame((t,f)=>this.onXRFrame(t,f));
    const pose=frame.getViewerPose(this.referenceSpace);if(!pose)return;
    if(!this.arPlaced&&this.hitSource){
      const hits=frame.getHitTestResults(this.hitSource);
      if(hits.length){const hitPose=hits[0].getPose(this.referenceSpace);this.reticle=hitPose.transform.matrix;this.modelMatrix=new Float32Array(this.reticle);if(this.hud)this.hud.dataset.surface='found';}
      else{this.reticle=null;if(this.hud)this.hud.dataset.surface='searching';}
    }
    const gl=this.gl,layer=session.renderState.baseLayer;gl.bindFramebuffer(gl.FRAMEBUFFER,layer.framebuffer);gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(this.program);
    for(const view of pose.views){
      const viewport=layer.getViewport(view);gl.viewport(viewport.x,viewport.y,viewport.width,viewport.height);
      const base=new Float32Array(view.transform.inverse.matrix),projection=new Float32Array(view.projectionMatrix),yaw=mat4RotateY(this.angle);
      const placement=mat4Multiply(this.modelMatrix,yaw);
      const model=placement;
      gl.uniformMatrix4fv(this.locations.projection,false,projection);gl.uniformMatrix4fv(this.locations.view,false,base);gl.uniformMatrix4fv(this.locations.model,false,model);gl.drawArrays(gl.TRIANGLES,0,this.vertexCount);
    }
  }
  async endAR(){
    if(this.xrEnding)return;this.xrEnding=true;
    this.session=null;this.hitSource?.cancel?.();this.hitSource=null;this.referenceSpace=null;this.reticle=null;this.arPlaced=false;this.canvas.classList.remove('ar-hidden-canvas');this.hud?.classList.remove('ar-active');if(this.hud){this.hud.innerHTML='';delete this.hud.dataset.surface;}this.render();this.xrEnding=false;
  }
  async exitAR(){if(this.session){const session=this.session;this.session=null;try{await session.end();}catch{}this.endAR();}}
  dispose(){this.resizeObserver?.disconnect();this.exitAR();const gl=this.gl;if(gl&&this.buffers){for(const buffer of Object.values(this.buffers))gl.deleteBuffer(buffer);gl.deleteProgram(this.program);}this.gl=null;}
}







