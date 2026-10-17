(() => {
'use strict';
const $ = id => document.getElementById(id);
const screens = ['homeScreen','levelScreen','howScreen','gameScreen','winScreen'];
const canvas = $('gameCanvas'), ctx = canvas.getContext('2d');
const SAVE_KEY = 'ragetrap-save-v1';
const TOTAL_LEVELS = 100, STAGES_PER_LEVEL = 3, TOTAL_STAGES = 300;
let save = loadSave(), level = 1, stage = 1, deaths = 0, attempt = 1, running = false, raf = 0;
let player, world, keys = {left:false,right:false,jump:false}, lastTime = 0, jumpBuffer = 0, coyote = 0, soundOn = true, audioCtx = null, lastDeathAt = 0;

function defaultSave(){return {highestLevel:1,clearedStages:[],deaths:0,bestAttempts:{},lastLevel:1,lastStage:1};}
function loadSave(){try{const s=JSON.parse(localStorage.getItem(SAVE_KEY));return s&&Array.isArray(s.clearedStages)?{...defaultSave(),...s}:defaultSave();}catch(e){return defaultSave();}}
function persist(){try{localStorage.setItem(SAVE_KEY,JSON.stringify(save));}catch(e){} updateStats();}
function stageId(l,s){return (l-1)*3+s;}
function clearedCount(){return save.clearedStages.length;}
function isCleared(l,s){return save.clearedStages.includes(stageId(l,s));}
function maxUnlockedStage(){return Math.min(TOTAL_STAGES,clearedCount()+1);}
function showScreen(id){screens.forEach(s=>$(s).classList.toggle('hidden',s!==id));}
function updateStats(){
  $('progressTop').textContent=`LEVEL ${level} · STAGE ${stage}`;
  $('deathsTop').textContent=`DEATHS ${save.deaths}`;
  $('homeLevels').textContent=`${Math.max(0, Math.min(100, Math.floor(clearedCount()/3)))} / 100`;
  $('homeStages').textContent=`${clearedCount()} / 300`;
  $('homeDeaths').textContent=save.deaths;
  $('deathsGame').textContent=save.deaths;
  $('bestGame').textContent=save.bestAttempts[stageId(level,stage)] ?? '—';
  $('levelName').textContent=`LEVEL ${level}`;
  $('stageName').textContent=`STAGE ${stage} / 3`;
  $('attemptText').textContent=`ATTEMPT ${attempt}`;
}
function renderLevelGrid(){
  const grid=$('levelGrid');grid.innerHTML='';
  for(let l=1;l<=TOTAL_LEVELS;l++){
    const btn=document.createElement('button'), unlocked=l<=save.highestLevel, done=l*3<=clearedCount();
    btn.className='level-tile'+(unlocked?' unlocked':'')+(done?' done':'')+(l===level?' current':'');
    btn.textContent=done?'✓':(!unlocked?'🔒':String(l));btn.disabled=!unlocked;
    btn.setAttribute('aria-label',`Level ${l}${unlocked?'':' locked'}`);
    btn.addEventListener('click',()=>{level=l;stage=1;while(stage<3&&isCleared(level,stage))stage++;startStage();});
    grid.appendChild(btn);
  }
}
function hash(l,s){let x=(l*73856093)^(s*19349663);x^=x<<13;x^=x>>>17;x^=x<<5;return Math.abs(x>>>0);}
function makeWorld(l,s){
  const seed=hash(l,s), rand=(()=>{let x=seed||12345;return()=>{x=(x*1664525+1013904223)>>>0;return x/4294967296;};})();
  const difficulty=(l-1)/99, floorY=420;
  const w={floorY,platforms:[],spikes:[],moving:[],crumble:[],fake:[],exit:{x:842,y:floorY-58,w:28,h:58},worldWidth:900,
    speed:210+difficulty*65,jump:470+difficulty*15,trapChance:.12+difficulty*.42};
  // Main floor is split into segments. Gaps are possible but always followed by a landing platform.
  let x=0;
  while(x<840){
    const seg=90+rand()*80, gap=(rand()<(.10+difficulty*.22)&&x>80)?(18+rand()*(12+difficulty*28)):0;
    const end=Math.min(840,x+seg);
    w.platforms.push({x,y:floorY,w:end-x,h:80,type:'solid'});
    if(gap>0&&end<840)w.platforms.push({x:end+gap,y:floorY,w:Math.min(70,900-end-gap),h:80,type:'landing'});
    x=end+gap;
  }
  // Guaranteed initial safe runway and exit platform.
  w.platforms.push({x:0,y:floorY,w:155,h:80,type:'solid'});
  w.platforms.push({x:760,y:floorY,w:140,h:80,type:'solid'});
  // Platforms and hazards; ensure a traversable route by keeping hazards above the floor.
  const count=3+Math.floor(l/7)+s;
  for(let i=0;i<count;i++){
    const hx=180+i*(590/count)+rand()*35, type=rand();
    if(type<.34){
      w.spikes.push({x:hx,y:floorY-22,w:24+rand()*18,h:22,hidden:rand()<w.trapChance,triggered:false});
    }else if(type<.62){
      w.moving.push({x:hx,y:floorY-75-rand()*45,w:22+rand()*18,h:18,baseY:floorY-75-rand()*45,amp:12+rand()*(20+difficulty*35),phase:rand()*6.28,speed:1.2+difficulty*2.2});
    }else{
      const py=floorY-(85+rand()*65);
      w.platforms.push({x:hx,y:py,w:55+rand()*35,h:12,type:rand()<w.trapChance?'crumble':'solid',timer:0});
    }
  }
  // Add a stage-specific signature trap, with visible warning at higher levels.
  if(l>=4){w.fake.push({x:330+rand()*220,y:floorY-10,w:55,h:10,triggered:false});}
  if(l>=15){w.moving.push({x:450,y:floorY-125,w:48,h:16,baseY:floorY-125,amp:38+difficulty*70,phase:1.4,speed:1.4+difficulty*2.6});}
  if(l>=35){w.spikes.push({x:590,y:floorY-22,w:48,h:22,hidden:true,triggered:false});}
  w.exit.x=842; return w;
}
function resetPlayer(){player={x:42,y:world.floorY-38,w:22,h:32,vx:0,vy:0,onGround:false,dead:false,face:1};jumpBuffer=0;coyote=0;}
function startStage(){
  cancelAnimationFrame(raf);world=makeWorld(level,stage);resetPlayer();running=true;attempt=Number(save.bestAttempts[stageId(level,stage)]||0)+1;
  $('overlay').classList.add('hidden');$('hintText').textContent=level<10?'Reach the exit. Trust nothing.':'Watch your step. The traps are getting smarter.';
  updateStats();showScreen('gameScreen');lastTime=performance.now();raf=requestAnimationFrame(loop);
}
function stopGame(){running=false;cancelAnimationFrame(raf);}
function die(reason='The trap got you.'){
  if(player.dead)return;player.dead=true;running=false;cancelAnimationFrame(raf);save.deaths++;deaths++;persist();playSfx('death');
  $('overlayEyebrow').textContent='NICE TRY';$('overlayTitle').textContent='TRAPPED!';$('overlayText').textContent=reason;
  $('overlayBtn').textContent='TRY AGAIN ↻';$('overlay').classList.remove('hidden');updateStats();
}
function clearStage(){
  if(!running)return;running=false;cancelAnimationFrame(raf);
  const id=stageId(level,stage);if(!isCleared(level,stage))save.clearedStages.push(id);
  save.clearedStages.sort((a,b)=>a-b);save.highestLevel=Math.min(100,Math.max(save.highestLevel,level+(stage===3?1:0)));
  save.lastLevel=level;save.lastStage=stage;save.bestAttempts[id]=Math.min(Number(save.bestAttempts[id]||Infinity),attempt);persist();playSfx(level===100&&stage===3?'levelup':'clear');
  $('winTitle').textContent=(level===100&&stage===3)?'YOU BEAT RAGETRAP!':'STAGE CLEARED!';
  $('winText').textContent=(level===100&&stage===3)?'You survived all 300 stages. Absolute legend.':'Good. Now it gets worse.';
  $('winDeaths').textContent=save.deaths;$('winProgress').textContent=`${clearedCount()} / 300`;
  $('nextBtn').textContent=(level===100&&stage===3)?'PLAY AGAIN ↻':'NEXT STAGE →';
  showScreen('winScreen');
}
function rectHit(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;}
function solidAt(px,py,pw,ph,vy){
  for(const p of world.platforms){if(p.type==='gone')continue;
    if(px+pw>p.x&&px<p.x+p.w&&py+ph>=p.y&&py+ph<=p.y+Math.max(20,vy*0.04+8)&&vy>=0)return p;}
  return null;
}
function update(dt){
  if(!running)return;
  const diff=(level-1)/99;
  world.moving.forEach(m=>{m.y=m.baseY+Math.sin(performance.now()/1000*m.speed+m.phase)*m.amp;});
  if(keys.jump)jumpBuffer=.13;else jumpBuffer=Math.max(0,jumpBuffer-dt);
  if(player.onGround)coyote=.11;else coyote=Math.max(0,coyote-dt);
  const dir=(keys.right?1:0)-(keys.left?1:0);player.vx=dir*world.speed;if(dir)player.face=dir;
  if(jumpBuffer>0&&coyote>0){player.vy=-world.jump;player.onGround=false;jumpBuffer=0;coyote=0;playSfx('jump');}
  player.vy+=1250*dt;player.vy=Math.min(player.vy,850);
  const oldY=player.y;player.x+=player.vx*dt;player.x=Math.max(0,Math.min(876,player.x));
  player.y+=player.vy*dt;player.onGround=false;
  if(player.y+player.h>=world.floorY&&oldY+player.h<=world.floorY+10&&player.vy>=0){
    player.y=world.floorY-player.h;player.vy=0;player.onGround=true;
  }
  const p=solidAt(player.x,player.y,player.w,player.h,player.vy);
  if(p){player.y=p.y-player.h;player.vy=0;player.onGround=true;if(p.type==='crumble'){p.timer+=dt;if(p.timer>.42)p.type='gone';}}
  // Collide with spikes; hidden spikes spring after the player approaches.
  for(const sp of world.spikes){
    if(sp.hidden&&!sp.triggered&&player.x+player.w>sp.x-45){sp.triggered=true;playSfx('trap');}
    if((!sp.hidden||sp.triggered)&&rectHit(player,{x:sp.x,y:sp.y,w:sp.w,h:sp.h}))return die('You trusted the floor. Rookie mistake.');
  }
  for(const f of world.fake){
    if(!f.triggered&&player.x+player.w>f.x-8){f.triggered=true;playSfx('trap');}
    if(f.triggered&&player.y+player.h>=world.floorY-2&&player.x+player.w>f.x&&player.x<f.x+f.w)return die('That platform was never your friend.');
  }
  for(const m of world.moving)if(rectHit(player,m))return die('Wrong timing. Try watching the pattern.');
  if(player.y>canvas.height+100)return die('Fell into the void. Gravity wins again.');
  if(rectHit(player,world.exit))clearStage();
}
function draw(){
  const W=canvas.width,H=canvas.height;ctx.clearRect(0,0,W,H);
  const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,'#17151f');g.addColorStop(1,'#0b0b11');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  // Subtle grid and distant skyline
  ctx.strokeStyle='#ffffff08';ctx.lineWidth=1;for(let x=0;x<W;x+=45){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}for(let y=0;y<H;y+=45){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
  for(let i=0;i<14;i++){const x=i*75;ctx.fillStyle='#ffffff05';ctx.fillRect(x,300-(i%4)*18,42,120);}
  // platforms
  for(const p of world.platforms){if(p.type==='gone')continue;ctx.fillStyle=p.type==='crumble'?'#65404b':'#292833';ctx.fillRect(p.x,p.y,p.w,p.h);ctx.fillStyle=p.type==='crumble'?'#ff596b':'#4b4a59';ctx.fillRect(p.x,p.y,p.w,4);if(p.type==='crumble'){ctx.strokeStyle='#ff687755';ctx.setLineDash([5,4]);ctx.strokeRect(p.x+3,p.y+3,p.w-6,p.h-6);ctx.setLineDash([]);}}
  // fake floor warning/trigger
  for(const f of world.fake){if(f.triggered){ctx.fillStyle='#ff414d';ctx.fillRect(f.x,f.y,f.w,4);}}
  // spikes
  for(const sp of world.spikes){if(sp.hidden&&!sp.triggered)continue;ctx.fillStyle='#ff414d';ctx.shadowColor='#ff414d';ctx.shadowBlur=12;const n=Math.max(2,Math.floor(sp.w/13));for(let i=0;i<n;i++){const x=sp.x+i*sp.w/n;ctx.beginPath();ctx.moveTo(x,sp.y+sp.h);ctx.lineTo(x+sp.w/n/2,sp.y);ctx.lineTo(x+sp.w/n,sp.y+sp.h);ctx.closePath();ctx.fill();}ctx.shadowBlur=0;}
  // moving hazards
  for(const m of world.moving){ctx.fillStyle='#ff414d';ctx.shadowColor='#ff414d';ctx.shadowBlur=14;ctx.fillRect(m.x,m.y,m.w,m.h);ctx.shadowBlur=0;ctx.fillStyle='#ffd7da';ctx.fillRect(m.x+4,m.y+4,m.w-8,3);}
  // exit gate
  ctx.fillStyle='#55efb0';ctx.shadowColor='#55efb0';ctx.shadowBlur=18;ctx.fillRect(world.exit.x,world.exit.y,world.exit.w,world.exit.h);ctx.shadowBlur=0;ctx.fillStyle='#0c3026';ctx.fillRect(world.exit.x+6,world.exit.y+8,world.exit.w-12,world.exit.h-8);ctx.fillStyle='#55efb0';ctx.font='bold 17px Inter';ctx.fillText('➜',world.exit.x+3,world.exit.y+34);
  // player glow
  ctx.shadowColor='#65b7ff';ctx.shadowBlur=15;ctx.fillStyle='#65b7ff';ctx.fillRect(player.x,player.y,player.w,player.h);ctx.shadowBlur=0;ctx.fillStyle='#101015';ctx.fillRect(player.x+(player.face>0?13:4),player.y+8,4,4);ctx.fillRect(player.x+(player.face>0?13:4),player.y+17,4,4);ctx.fillStyle='#c4e6ff';ctx.fillRect(player.x+4,player.y+3,player.w-8,3);
  // top canvas status
  ctx.fillStyle='#ffffffa0';ctx.font='800 12px Inter';ctx.fillText(`LEVEL ${level}  /  STAGE ${stage}`,18,25);
  ctx.fillStyle='#ff414d';ctx.fillRect(18,36,Math.max(28,level/100*120),3);
}
function loop(now){if(!running)return;const dt=Math.min(.033,(now-lastTime)/1000||0);lastTime=now;update(dt);if(running){draw();raf=requestAnimationFrame(loop);}else draw();}
function tone(freq, duration, type='sine', volume=.045, delay=0, endFreq=null){
  if(!soundOn)return;
  try{
    audioCtx=audioCtx||new (window.AudioContext||window.webkitAudioContext)();
    if(audioCtx.state==='suspended')audioCtx.resume();
    const start=audioCtx.currentTime+delay;
    const o=audioCtx.createOscillator(),g=audioCtx.createGain();
    o.type=type;o.frequency.setValueAtTime(freq,start);
    if(endFreq!==null)o.frequency.exponentialRampToValueAtTime(Math.max(1,endFreq),start+duration);
    g.gain.setValueAtTime(.0001,start);g.gain.exponentialRampToValueAtTime(volume,start+.012);
    g.gain.exponentialRampToValueAtTime(.0001,start+duration);
    o.connect(g);g.connect(audioCtx.destination);o.start(start);o.stop(start+duration+.02);
  }catch(e){}
}
function noiseBurst(duration=.12, volume=.035, delay=0){
  if(!soundOn)return;
  try{
    audioCtx=audioCtx||new (window.AudioContext||window.webkitAudioContext)();
    if(audioCtx.state==='suspended')audioCtx.resume();
    const length=Math.max(1,Math.floor(audioCtx.sampleRate*duration));
    const buffer=audioCtx.createBuffer(1,length,audioCtx.sampleRate),data=buffer.getChannelData(0);
    for(let i=0;i<length;i++)data[i]=(Math.random()*2-1)*(1-i/length);
    const source=audioCtx.createBufferSource(),filter=audioCtx.createBiquadFilter(),gain=audioCtx.createGain();
    filter.type='lowpass';filter.frequency.value=1600;
    gain.gain.setValueAtTime(volume,audioCtx.currentTime+delay);
    gain.gain.exponentialRampToValueAtTime(.0001,audioCtx.currentTime+delay+duration);
    source.buffer=buffer;source.connect(filter);filter.connect(gain);gain.connect(audioCtx.destination);
    source.start(audioCtx.currentTime+delay);source.stop(audioCtx.currentTime+delay+duration);
  }catch(e){}
}
function playTone(freq,duration,type='sine'){tone(freq,duration,type);}
function playSfx(name){
  if(!soundOn)return;
  switch(name){
    case 'jump':
      tone(300,.07,'square',.025,0,520);break;
    case 'trap':
      tone(220,.11,'sawtooth',.035,0,90);tone(120,.12,'square',.018,.06,65);break;
    case 'death':
      noiseBurst(.16,.04);tone(190,.22,'sawtooth',.035,0,48);tone(75,.24,'triangle',.025,.13,42);break;
    case 'clear':
      tone(523,.12,'triangle',.04);tone(659,.12,'triangle',.04,.10);tone(784,.18,'triangle',.045,.20);break;
    case 'levelup':
      tone(440,.11,'triangle',.04);tone(554,.11,'triangle',.04,.11);tone(659,.11,'triangle',.04,.22);tone(880,.28,'triangle',.05,.33);break;
    case 'click':
      tone(420,.035,'square',.018);break;
    case 'bgm':
      // Soft, synthesized menu motif; no external audio files required.
      tone(220,.8,'sine',.008,0);tone(277,.8,'sine',.006,.55);tone(330,1.0,'sine',.006,1.1);break;
  }
}
function setKey(k,on){if(k==='ArrowLeft'||k==='a'||k==='A')keys.left=on;if(k==='ArrowRight'||k==='d'||k==='D')keys.right=on;if(k===' '||k==='ArrowUp'||k==='w'||k==='W'||k==='Space')keys.jump=on;}
function bindHold(id,key){
  const b=$(id);const down=e=>{e.preventDefault();keys[key]=true;b.classList.add('pressed');};const up=e=>{e.preventDefault();keys[key]=false;b.classList.remove('pressed');};
  b.addEventListener('pointerdown',down);['pointerup','pointercancel','pointerleave'].forEach(ev=>b.addEventListener(ev,up));
}
$('playBtn').addEventListener('click',()=>{level=Math.min(save.lastLevel||1,save.highestLevel);stage=save.lastStage||1;if(stage>3)stage=1;if(stage>1&&!isCleared(level,stage-1))stage=1;startStage();});
$('continueBtn').addEventListener('click',()=>{level=Math.min(save.lastLevel||1,save.highestLevel);stage=save.lastStage||1;if(stage>1&&!isCleared(level,stage-1))stage=1;startStage();});
$('levelsBtn').addEventListener('click',()=>{renderLevelGrid();showScreen('levelScreen');});
$('howBtn').addEventListener('click',()=>showScreen('howScreen'));
$('homeBtn').addEventListener('click',()=>{stopGame();updateStats();showScreen('homeScreen');});
$('quitBtn').addEventListener('click',()=>{stopGame();showScreen('homeScreen');});
$('winMenu').addEventListener('click',()=>{updateStats();showScreen('homeScreen');});
$('nextBtn').addEventListener('click',()=>{if(level===100&&stage===3){save=defaultSave();persist();level=1;stage=1;startStage();return;}if(stage<3)stage++;else{level=Math.min(100,level+1);stage=1;}save.lastLevel=level;save.lastStage=stage;persist();startStage();});
$('overlayBtn').addEventListener('click',()=>{attempt++;startStage();});
$('overlayMenu').addEventListener('click',()=>{stopGame();showScreen('homeScreen');updateStats();});
$('soundBtn').addEventListener('click',()=>{soundOn=!soundOn;$('soundLabel').textContent=soundOn?'ON':'OFF';$('soundBtn').setAttribute('aria-pressed',String(soundOn));if(soundOn)playSfx('click');});
document.querySelectorAll('[data-back]').forEach(b=>b.addEventListener('click',()=>showScreen(b.dataset.back)));
bindHold('leftBtn','left');bindHold('rightBtn','right');bindHold('jumpBtn','jump');
window.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp',' ','w','W','a','A','d','D'].includes(e.key)){e.preventDefault();setKey(e.key,true);}});
window.addEventListener('keyup',e=>setKey(e.key,false));
window.addEventListener('blur',()=>{keys={left:false,right:false,jump:false};});
document.addEventListener('visibilitychange',()=>{if(document.hidden){keys={left:false,right:false,jump:false};}});
updateStats();showScreen('homeScreen');
})();
