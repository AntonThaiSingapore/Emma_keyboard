const levels = [
  { name: 'Home row warm-up', label: 'TYPE THE HIGHLIGHTED KEY', items: ['f','j','d','k','s','l','a',';'] },
  { name: 'Reach & return', label: 'TYPE THE HIGHLIGHTED KEY', items: ['q','p','w','o','e','i','r','u','t','y','g','h','v','m','b','n','c','x','z'] },
  { name: 'Word builder', label: 'TYPE THE WORD', items: ['calm','kind','dream','focus','bright','wonder','rhythm','galaxy'] },
  { name: 'Pop culture mix', label: 'TYPE THE TITLE', items: ['Dynamite','Butter','God’s Menu','Spider-Man','The Lion King','Starlight','Wonder Woman'] },
  { name: 'Big ideas', label: 'TYPE THE SENTENCE', items: ['Every great journey begins with one small step.','The stars shine brightest on the darkest nights.','Energy can change forms, but it cannot be created or destroyed.','A fraction represents a part of a whole.','Stay curious, keep learning, and be kind.'] }
];
const fingerNames = {leftPinky:'LEFT PINKY',leftRing:'LEFT RING',leftMiddle:'LEFT MIDDLE',leftIndex:'LEFT INDEX',leftThumb:'LEFT THUMB',rightThumb:'RIGHT THUMB',rightIndex:'RIGHT INDEX',rightMiddle:'RIGHT MIDDLE',rightRing:'RIGHT RING',rightPinky:'RIGHT PINKY'};
const fingers = {q:'leftPinky',a:'leftPinky',z:'leftPinky',w:'leftRing',s:'leftRing',x:'leftRing',e:'leftMiddle',d:'leftMiddle',c:'leftMiddle',r:'leftIndex',f:'leftIndex',v:'leftIndex',t:'leftIndex',g:'leftIndex',b:'leftIndex',y:'rightIndex',h:'rightIndex',n:'rightIndex',u:'rightIndex',j:'rightIndex',m:'rightIndex',i:'rightMiddle',k:'rightMiddle',',':'rightMiddle',o:'rightRing',l:'rightRing','.':'rightRing',p:'rightPinky',';':'rightPinky','/':'rightPinky',' ':'rightThumb'};
const rows = [['`','1','2','3','4','5','6','7','8','9','0','-','=','BACKSPACE'],['TAB','q','w','e','r','t','y','u','i','o','p','[',']','\\'],['CAPS','a','s','d','f','g','h','j','k','l',';','\'','ENTER'],['SHIFT','z','x','c','v','b','n','m',',','.','/','SHIFT'],['CTRL','WIN','ALT','SPACE','ALT','CTRL']];
const specials = {BACKSPACE:'key-backspace',TAB:'key-tab',CAPS:'key-caps',ENTER:'key-enter',SHIFT:'key-shift',SPACE:'key-space'};
const keyboard = document.getElementById('keyboard');
rows.forEach(row => {const rowEl=document.createElement('div');rowEl.className='key-row';row.forEach(key=>{const el=document.createElement('div');el.className='key'+(specials[key]?' '+specials[key]:'')+(['TAB','CAPS','ENTER','SHIFT','CTRL','WIN','ALT','BACKSPACE'].includes(key)?' mod':'');el.dataset.key=key==='SPACE'?' ':key.toLowerCase();el.textContent=key==='SPACE'?'':key;if(['f','j'].includes(key))el.classList.add('f-home');rowEl.appendChild(el)});keyboard.appendChild(rowEl)});
let level=0,index=0,charPos=0,score=0,correct=0,attempts=0,streak=0;
let passed=JSON.parse(localStorage.getItem('keylight-passed')||'[true,false,false,false,false]');
let paused=false,sfx=true,music=false,audioCtx=null,musicTimer=null;
const $=id=>document.getElementById(id), promptEl=$('prompt'), dialog=$('settingsDialog');
function norm(s){return s.toLowerCase().replace(/[’‘]/g,"'")}
function fingerFor(ch){return fingers[ch.toLowerCase()]||'rightIndex'}
function escapeHtml(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function draw(){
  const list=levels[level].items,item=list[index];
  $('levelTag').textContent=`LEVEL ${String(level+1).padStart(2,'0')}`;$('levelName').textContent=levels[level].name;$('stageLabel').textContent=levels[level].label;
  $('score').textContent=String(score).padStart(3,'0');$('accuracy').textContent=(attempts?Math.round(correct/attempts*100):100)+'%';
  $('itemProgress').textContent=`${Math.min(index+1,list.length)} / ${list.length}`;$('progressBar').style.width=`${(index+(item?charPos/norm(item).length:0))/list.length*100}%`;
  $('streakText').textContent=streak>=5?`${streak} key streak!`:streak>=2?`${streak} in a row — nice`:'Find your rhythm';
  $('levelDots').innerHTML=levels.map((_,i)=>`<i class="level-dot ${i===level?'active':passed[i]?'done':''}"></i>`).join('');$('nextLevel').hidden=index>=list.length;$('pauseButton').textContent=paused?'▶':'Ⅱ';
  if(index>=list.length){const possible=list.reduce((n,s)=>n+norm(s).length*10,0),unlocked=score>=possible*Number($('passScore').value)/100;promptEl.innerHTML='<span class="current">✨ Level complete!</span>';$('hintText').textContent=unlocked?'Beautiful work — take a little bow.':`Reach ${$('passScore').value}% score to unlock the next level.`;$('fingerHint').textContent=unlocked?'WELL DONE':'KEEP PRACTICING';$('progressBar').style.width='100%';$('nextLevel').hidden=!unlocked;return}
  const target=norm(item),char=target[charPos],finger=fingerFor(char);let html='';
  for(let i=0;i<target.length;i++){const c=item[i];html+=`<span class="${i<charPos?'typed':i===charPos?'current':'future'} ${c===' '?'space':''}">${c===' '?'\u00a0':escapeHtml(c)}</span>`}
  promptEl.innerHTML=html;const hand=finger.startsWith('left')?'left':'right';document.querySelectorAll('.hand').forEach(h=>h.style.opacity=h.classList.contains(`hand-${hand}`)?'.34':'.16');
  document.querySelectorAll('.finger-dot').forEach(d=>d.classList.remove('active'));const suffix=finger.replace(hand,'').toLowerCase(),dot=document.querySelector(`.hand-${hand} .dot-${suffix}`);if(dot)dot.classList.add('active');
  document.querySelectorAll('.key').forEach(k=>k.classList.remove('target','home-target'));const keyEl=[...document.querySelectorAll('.key')].find(k=>k.dataset.key===char);if(keyEl)keyEl.classList.add('target');
  ['f','j'].forEach(k=>{const e=document.querySelector(`.key[data-key="${k}"]`);if(e&&(!keyEl||!keyEl.classList.contains('target')))e.classList.add('home-target')});
  $('fingerHint').textContent=fingerNames[finger]||'RIGHT INDEX';$('hintText').textContent=`${char===' '?'Press space':`Type “${item[charPos]}”`} using your ${fingerNames[finger]?.toLowerCase()||'right index finger'}`;
}
function toast(msg){const el=$('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),1700)}
function wrongSound(){if(!sfx)return;try{audioCtx??=new(window.AudioContext||window.webkitAudioContext)();const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type='sine';o.frequency.value=180;g.gain.setValueAtTime(.08,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+.16);o.connect(g);g.connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+.17)}catch{}}
function musicStart(){try{audioCtx??=new(window.AudioContext||window.webkitAudioContext)();if(musicTimer)return;const notes=[261.63,329.63,392,523.25,392,329.63,293.66,349.23,440,587.33,440,349.23];let n=0;musicTimer=setInterval(()=>{if(!music)return;const osc=audioCtx.createOscillator(),gain=audioCtx.createGain();osc.type='sine';osc.frequency.value=notes[n++%notes.length];gain.gain.setValueAtTime(.0001,audioCtx.currentTime);gain.gain.exponentialRampToValueAtTime(.022,audioCtx.currentTime+.04);gain.gain.exponentialRampToValueAtTime(.0001,audioCtx.currentTime+.5);osc.connect(gain);gain.connect(audioCtx.destination);osc.start();osc.stop(audioCtx.currentTime+.52)},290)}catch{}}
function setMusic(v){music=v;$('musicToggle').setAttribute('aria-pressed',v);$('musicToggle').textContent=v?'♪ MUSIC ON':'♪ MUSIC OFF';$('dialogMusic').classList.toggle('on',v);$('dialogMusic').setAttribute('aria-checked',v);if(v)musicStart()}
function setSfx(v){sfx=v;$('sfxToggle').setAttribute('aria-pressed',v);$('sfxToggle').textContent=v?'♫ SOUND ON':'♫ SOUND OFF';$('dialogSfx').classList.toggle('on',v);$('dialogSfx').setAttribute('aria-checked',v)}
function advance(){
  correct++;score+=10;streak++;charPos++;if(charPos>=norm(levels[level].items[index]).length){index++;charPos=0}
  $('feedback').textContent=streak>=5?'On fire! Keep that rhythm 🔥':streak>=3?'Lovely flow — keep going ✨':'Nice one!';$('feedback').className='feedback show';promptEl.classList.remove('pop');void promptEl.offsetWidth;promptEl.classList.add('pop');
  if(index>=levels[level].items.length){const possible=levels[level].items.reduce((n,s)=>n+norm(s).length*10,0);if(score>=possible*Number($('passScore').value)/100){passed[level]=true;localStorage.setItem('keylight-passed',JSON.stringify(passed));toast(`Level ${level+1} complete! You did it! ✨`)}else toast(`Level complete! Reach ${$('passScore').value}% score to unlock next.`)}else if(streak===5||streak===10)toast(`${streak} in a row! You’re flying! ✨`);
  draw();setTimeout(()=>$('feedback').classList.remove('show'),850)
}
function handle(ch){if(paused||index>=levels[level].items.length)return;const expected=norm(levels[level].items[index])[charPos];attempts++;if(norm(ch)===expected)advance();else{$('accuracy').textContent=Math.round(correct/attempts*100)+'%';streak=0;$('feedback').textContent='Almost! Try the glowing key.';$('feedback').className='feedback show error';wrongSound();document.querySelector('.key.target')?.animate([{transform:'translateX(0)'},{transform:'translateX(-4px)'},{transform:'translateX(4px)'},{transform:'translateX(0)'}],{duration:180});setTimeout(()=>$('feedback').classList.remove('show'),700)}}
document.addEventListener('keydown',e=>{if(e.ctrlKey||e.metaKey||e.altKey||dialog.open)return;if(e.key==='Escape'){paused=!paused;draw();toast(paused?'Practice paused':'Back in the flow');return}if(e.key.length===1){e.preventDefault();handle(e.key)}});
$('nextLevel').addEventListener('click',()=>{const possible=levels[level].items.reduce((n,s)=>n+norm(s).length*10,0);if(level<levels.length-1&&score>=possible*Number($('passScore').value)/100){level++;index=0;charPos=0;score=0;correct=0;attempts=0;streak=0;draw()}else if(level<levels.length-1)toast(`Reach ${$('passScore').value}% score to unlock next`);else{toast('You completed every level! Amazing work!');level=0;index=0;charPos=0;score=0;correct=0;attempts=0;streak=0;draw()}});
$('pauseButton').addEventListener('click',()=>{paused=!paused;draw();toast(paused?'Practice paused':'Back in the flow')});$('settingsOpen').addEventListener('click',()=>dialog.showModal());
$('fontSize').addEventListener('input',e=>{$('fontSizeValue').value=e.target.value+' px';promptEl.style.fontSize=e.target.value+'px'});$('passScore').addEventListener('input',e=>$('passScoreValue').value=e.target.value+'%');
$('dialogSfx').addEventListener('click',()=>setSfx(!sfx));$('dialogMusic').addEventListener('click',()=>setMusic(!music));$('sfxToggle').addEventListener('click',()=>setSfx(!sfx));$('musicToggle').addEventListener('click',()=>setMusic(!music));
$('resetProgress').addEventListener('click',()=>{index=0;charPos=0;score=0;correct=0;attempts=0;streak=0;paused=false;draw();dialog.close();toast('Fresh start. You’ve got this!')});draw();

