const cache = new Map();
let removerPromise;
async function isolateImage(source) {
  if (cache.has(source)) return cache.get(source);
  const task = (async () => {
    if (!removerPromise) removerPromise = import('https://esm.sh/@imgly/background-removal@1.5.5?bundle');
    const library = await removerPromise;
    const response = await fetch(source);
    if (!response.ok) throw new Error('Não foi possível carregar a foto do produto.');
    return URL.createObjectURL(await library.removeBackground(await response.blob(), {
      output: { format: 'image/png', quality: 0.92 }
    }));
  })();
  cache.set(source, task);
  try { return await task; } catch (error) { cache.delete(source); throw error; }
}
export async function mountPhotoModel(container, source, name = 'produto') {
  if (!container || !source) return;
  container.innerHTML = '<div class="photo3d-loading"><span class="photo3d-spinner"></span><b>Preparando seu modelo</b><small>IA isolando o alimento e removendo o fundo da foto…</small></div>';
  try {
    const isolated = await isolateImage(source);
    if (!container.isConnected) return;
    const safeName = String(name).replace(/[&<>"]/g, '');
    container.innerHTML = '<div class="photo3d-viewer" role="img" aria-label="Visualização 3D aproximada de ' + safeName + '"><div class="photo3d-shadow"></div><div class="photo3d-stack">' + Array.from({length:9},(_,i)=>'<img class="photo3d-layer" alt="" draggable="false" src="' + isolated + '" style="--layer:' + i + '">').join('') + '<img class="photo3d-face" alt="' + safeName + '" draggable="false" src="' + isolated + '"></div><span class="photo3d-caption">MODELO 3D A PARTIR DA FOTO</span><span class="photo3d-hint">Arraste para girar</span></div>';
    const viewer = container.querySelector('.photo3d-viewer'), stack = container.querySelector('.photo3d-stack');
    let down = false, lastX = 0, lastY = 0, yaw = -12, pitch = 4;
    const paint = () => { stack.style.transform = 'rotateX(' + pitch + 'deg) rotateY(' + yaw + 'deg)'; };
    viewer.addEventListener('pointerdown', event => {down=true;lastX=event.clientX;lastY=event.clientY;viewer.setPointerCapture(event.pointerId);viewer.classList.add('is-dragging')});
    viewer.addEventListener('pointermove', event => {if(!down)return;yaw+=(event.clientX-lastX)*.65;pitch=Math.max(-24,Math.min(28,pitch-(event.clientY-lastY)*.35));lastX=event.clientX;lastY=event.clientY;paint()});
    const stop=()=>{down=false;viewer.classList.remove('is-dragging')};
    viewer.addEventListener('pointerup',stop);viewer.addEventListener('pointercancel',stop);paint();
  } catch (error) {
    if (!container.isConnected) return;
    container.innerHTML = '<div class="photo3d-error"><b>Não foi possível isolar o alimento automaticamente.</b><p>' + String(error.message || 'Verifique sua conexão e tente novamente.').replace(/[&<>"]/g, '') + '</p><button type="button" class="button button-outline button-small" data-action="view-art">Voltar à foto</button></div>';
  }
}