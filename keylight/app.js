const levels = [
  { name: 'Home row warm-up', label: 'TYPE THE HIGHLIGHTED KEY', items: ['f','j','d','k','s','l','a',';'] },
  { name: 'Reach & return', label: 'TYPE THE HIGHLIGHTED KEY', items: ['q','p','w','o','e','i','r','u','t','y','g','h','v','m','b','n','c','x','z'] },
  { name: 'Word builder', label: 'TYPE THE WORD', items: ['calm','kind','dream','focus','bright','wonder','rhythm','galaxy'] },
  { name: 'Pop culture mix', label: 'TYPE THE TITLE', items: ['Dynamite','Butter','God’s Menu','Spider-Man','The Lion King','Starlight','Wonder Woman'] },
  { name: 'Big ideas', label: 'TYPE THE SENTENCE', items: ['Every great journey begins with one small step.','The stars shine brightest on the darkest nights.','Energy can change forms, but it cannot be created or destroyed.','A fraction represents a part of a whole.','Stay curious, keep learning, and be kind.'] }
];
const fingerNames = {leftPinky:'LEFT PINKY',leftRing:'LEFT RING',leftMiddle:'LEFT MIDDLE',leftIndex:'LEFT INDEX',leftThumb:'LEFT THUMB',rightThumb:'RIGHT THUMB',rightIndex:'RIGHT INDEX',rightMiddle:'RIGHT MIDDLE',rightRing:'RIGHT RING',rightPinky:'RIGHT PINKY'};
const fingers = {q:'leftPinky',a:'leftPinky',z:'leftPinky',w:'leftRing',s:'leftRing',x:'leftRing',e:'leftMiddle',d:'leftMiddle',c:'leftMiddle',r:'leftIndex',f:'leftIndex',v:'leftIndex',t:'leftIndex',g:'leftIndex',b:'leftIndex',y:'rightIndex',h:'rightIndex',n:'rightIndex',u:'rightIndex',j:'rightIndex',m:'rightIndex',i:'rightMiddle',k:'rightMiddle',',':'rightMiddle',o:'rightRing',l:'rightRing','.':'rightRing',p:'rightPinky',';':'rightPinky','/':'rightPinky','[':'rightPinky',']':'rightPinky','-':'rightPinky','=':'rightPinky',' ':'rightThumb'};
fingers['\\']='rightPinky';
fingers["'"]='rightPinky';
const keyRows = [['`','1','2','3','4','5','6','7','8','9','0','-','=','BACKSPACE'],['TAB','q','w','e','r','t','y','u','i','o','p','[',']','\\'],['CAPS','a','s','d','f','g','h','j','k','l',';','\'','ENTER'],['SHIFT','z','x','c','v','b','n','m',',','.','/','SHIFT'],['CTRL','WIN','ALT','SPACE','ALT','CTRL']];
const keyWidths = {BACKSPACE:'key-backspace',TAB:'key-tab',CAPS:'key-caps',ENTER:'key-enter',SHIFT:'key-shift',SPACE:'key-space'};
const settings = {
  fontSize: Number(localStorage.getItem('keylight-font-size')) || 48,
  passScore: Number(localStorage.getItem('keylight-pass-score')) || 60,
  photoSeconds: Number(localStorage.getItem('keylight-photo-seconds')) || 15,
  sound: localStorage.getItem('keylight-sound') !== 'off',
  music: localStorage.getItem('keylight-music') === 'on'
};
let level=0,index=0,charPos=0,score=0,correct=0,attempts=0,streak=0,paused=false;
let passed=JSON.parse(localStorage.getItem('keylight-passed')||'[true,false,false,false,false]');
let audioCtx=null,photoTimer=null,photoPosition=-1,activePhotoLayer='A',musicGain=null,musicOscillators=[];
const $=id=>document.getElementById(id), promptEl=$('prompt');
const licensedPhotos = [
  {title:'BLACKPINK',file:'Blackpink.jpg',page:'https://commons.wikimedia.org/wiki/File:Blackpink.jpg',author:'HeyDay',license:'CC BY 4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/'},
  {title:'Taylor Swift',file:'Taylor Swift Eras Tour TTPD Set Fortnight.jpg',page:'https://commons.wikimedia.org/wiki/File:Taylor_Swift_Eras_Tour_TTPD_Set_Fortnight.jpg',author:'Vixy13',license:'CC BY 4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/'},
  {title:'Coldplay',file:'ColdplayManch030623 (9 of 118) (52950653350).jpg',page:'https://commons.wikimedia.org/wiki/File:ColdplayManch030623_(9_of_118)_(52950653350).jpg',author:'Raph_PH',license:'CC BY 2.0',licenseUrl:'https://creativecommons.org/licenses/by/2.0/'},
  {title:'Ed Sheeran',file:'Ed Sheeran performing live.jpg',page:'https://commons.wikimedia.org/wiki/File:Ed_Sheeran_performing_live.jpg',author:'kaddyyy',license:'CC BY 2.0',licenseUrl:'https://creativecommons.org/licenses/by/2.0/'},
  {title:'Stray Kids',file:'Stray Kids in 2026.png',page:'https://commons.wikimedia.org/wiki/File:Stray_Kids_in_2026.png',author:'TV10',license:'CC BY 4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/'},
  {title:'BTS',file:'BTS in concert at Wembley Stadium, 2 June 2019 01.jpg',page:'https://commons.wikimedia.org/wiki/File:BTS_in_concert_at_Wembley_Stadium,_2_June_2019_01.jpg',author:'NenehTrainer',license:'CC BY 3.0',licenseUrl:'https://creativecommons.org/licenses/by/3.0/'}
];
function allPhotos(){return licensedPhotos}
function norm(s){return s.toLowerCase().replace(/[’‘]/g,"'")}
function fingerFor(ch){return fingers[ch.toLowerCase()]||'rightIndex'}
function escapeHtml(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function buildKeyboard(){
  const keyboard=$('keyboard');
  keyRows.forEach(row=>{const rowEl=document.createElement('div');rowEl.className='key-row';row.forEach(key=>{const el=document.createElement('div');el.className='key'+(keyWidths[key]?' '+keyWidths[key]:'')+(['TAB','CAPS','ENTER','SHIFT','CTRL','WIN','ALT','BACKSPACE'].includes(key)?' mod':'');el.dataset.key=key==='SPACE'?' ':key.toLowerCase();el.textContent=key==='SPACE'?'':key;if(['f','j'].includes(key))el.classList.add('f-home');rowEl.appendChild(el)});keyboard.appendChild(rowEl)});
}
function possibleScore(){return levels[level].items.reduce((n,s)=>n+norm(s).length*10,0)}
function draw(){
  const list=levels[level].items,item=list[index];
  $('levelTag').textContent=`LEVEL ${String(level+1).padStart(2,'0')}`;$('levelName').textContent=levels[level].name;$('stageLabel').textContent=levels[level].label;
  $('score').textContent=String(score).padStart(3,'0');$('accuracy').textContent=(attempts?Math.round(correct/attempts*100):100)+'%';
  $('itemProgress').textContent=`${Math.min(index+1,list.length)} / ${list.length}`;$('progressBar').style.width=`${(index+(item?charPos/norm(item).length:0))/list.length*100}%`;
  $('streakText').textContent=streak>=5?`${streak} key streak!`:streak>=2?`${streak} in a row — nice`:'Find your rhythm';
  $('levelDots').innerHTML=levels.map((_,i)=>`<i class="level-dot ${i===level?'active':passed[i]?'done':''}"></i>`).join('');$('nextLevel').hidden=index>=list.length;$('pauseButton').textContent=paused?'▶':'Ⅱ';
  if(index>=list.length){const unlocked=score>=possibleScore()*settings.passScore/100;promptEl.innerHTML='<span class="current">✨ Level complete!</span>';$('hintText').textContent=unlocked?'Beautiful work — take a little bow.':`Reach ${settings.passScore}% score to unlock the next level.`;$('fingerHint').textContent=unlocked?'WELL DONE':'KEEP PRACTICING';$('progressBar').style.width='100%';$('nextLevel').hidden=!unlocked;return}
  const target=norm(item),char=target[charPos],finger=fingerFor(char);let html='';
  for(let i=0;i<target.length;i++){const c=item[i];html+=`<span class="${i<charPos?'typed':i===charPos?'current':'future'} ${c===' '?'space':''}">${c===' '?'\u00a0':escapeHtml(c)}</span>`}
  promptEl.innerHTML=html;
  const hand=finger.startsWith('left')?'left':'right';
  document.querySelectorAll('.hand').forEach(h=>h.style.opacity=h.classList.contains(`hand-${hand}`)?'.42':'.19');
  document.querySelectorAll('.finger-track').forEach(path=>path.classList.remove('active'));
  const fingerClass=finger.replace(hand,'').toLowerCase();document.querySelectorAll(`.hand-${hand} .strip-${fingerClass}`).forEach(path=>path.classList.add('active'));
  document.querySelectorAll('.key').forEach(k=>k.classList.remove('target','home-target'));
  const keyEl=[...document.querySelectorAll('.key')].find(k=>k.dataset.key===char);if(keyEl)keyEl.classList.add('target');
  ['f','j'].forEach(k=>{const e=document.querySelector(`.key[data-key="${k}"]`);if(e&&(!keyEl||!keyEl.classList.contains('target')))e.classList.add('home-target')});
  $('fingerHint').textContent=fingerNames[finger]||'RIGHT INDEX';$('hintText').textContent=`${char===' '?'Press space':`Type “${item[charPos]}”`} using your ${fingerNames[finger]?.toLowerCase()||'right index finger'}`;
}
function toast(msg){const el=$('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),1800)}
function wrongSound(){if(!settings.sound)return;try{audioCtx??=new(window.AudioContext||window.webkitAudioContext)();const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type='sine';o.frequency.value=180;g.gain.setValueAtTime(.08,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+.16);o.connect(g);g.connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+.17)}catch{}}
function advance(){
  correct++;score+=10;streak++;charPos++;if(charPos>=norm(levels[level].items[index]).length){index++;charPos=0}
  $('feedback').textContent=streak>=5?'On fire! Keep that rhythm 🔥':streak>=3?'Lovely flow — keep going ✨':'Nice one!';$('feedback').className='feedback show';promptEl.classList.remove('pop');void promptEl.offsetWidth;promptEl.classList.add('pop');
  if(index>=levels[level].items.length){if(score>=possibleScore()*settings.passScore/100){passed[level]=true;localStorage.setItem('keylight-passed',JSON.stringify(passed));toast(`Level ${level+1} complete! You did it! ✨`)}else toast(`Level complete! Reach ${settings.passScore}% score to unlock next.`)}else if(streak===5||streak===10)toast(`${streak} in a row! You’re flying! ✨`);
  draw();setTimeout(()=>$('feedback').classList.remove('show'),850)
}
function handle(ch){
  if(paused||index>=levels[level].items.length)return;
  const expected=norm(levels[level].items[index])[charPos];attempts++;
  if(norm(ch)===expected)advance();
  else{$('accuracy').textContent=Math.round(correct/attempts*100)+'%';streak=0;$('feedback').textContent='Almost! Try the glowing key.';$('feedback').className='feedback show error';wrongSound();document.querySelector('.key.target')?.animate([{transform:'translateX(0)'},{transform:'translateX(-4px)'},{transform:'translateX(4px)'},{transform:'translateX(0)'}],{duration:180});setTimeout(()=>$('feedback').classList.remove('show'),700)}
}
function syncSettings(){
  $('fontSize').value=settings.fontSize;$('fontSizeValue').value=`${settings.fontSize} px`;promptEl.style.fontSize=`${settings.fontSize}px`;
  $('passScore').value=settings.passScore;$('passScoreValue').value=`${settings.passScore}%`;
  $('photoSeconds').value=settings.photoSeconds;$('photoSecondsValue').value=`${settings.photoSeconds} sec`;
  $('sfxToggle').classList.toggle('on',settings.sound);$('sfxToggle').setAttribute('aria-checked',String(settings.sound));
  $('musicToggle').classList.toggle('on',settings.music);$('musicToggle').setAttribute('aria-checked',String(settings.music));
}
function setSound(on){settings.sound=on;localStorage.setItem('keylight-sound',on?'on':'off');syncSettings()}
function setMusic(on){
  settings.music=on;localStorage.setItem('keylight-music',on?'on':'off');
  try{
    audioCtx??=new(window.AudioContext||window.webkitAudioContext)();
    if(on){
      if(audioCtx.state==='suspended')audioCtx.resume();
      if(!musicGain){musicGain=audioCtx.createGain();musicGain.gain.value=0;musicGain.connect(audioCtx.destination);[220,277.18,329.63].forEach((hz,i)=>{const osc=audioCtx.createOscillator(),level=audioCtx.createGain();osc.type='sine';osc.frequency.value=hz;level.gain.value=[.32,.2,.13][i];osc.connect(level);level.connect(musicGain);osc.start();musicOscillators.push(osc)});}
      musicGain.gain.cancelScheduledValues(audioCtx.currentTime);musicGain.gain.setTargetAtTime(.045,audioCtx.currentTime,.8);
    }else if(musicGain){musicGain.gain.cancelScheduledValues(audioCtx.currentTime);musicGain.gain.setTargetAtTime(0,audioCtx.currentTime,.18)}
  }catch{}
  syncSettings();
}
function commonsFile(file){return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=1600`}
function photoUrl(photo){return photo.url||commonsFile(photo.file)}
function showPhoto(photo){
  const nextLayer=activePhotoLayer==='A'?'B':'A',next=$(nextLayer==='A'?'artistPhotoA':'artistPhotoB'),old=$(activePhotoLayer==='A'?'artistPhotoA':'artistPhotoB');
  next.onload=()=>{next.classList.add('active');old.classList.remove('active');activePhotoLayer=nextLayer};
  next.onerror=()=>{$('photoStatus').textContent='This image could not be loaded. The next photo will still appear on schedule.'};
  next.src=photoUrl(photo);$('artistTitle').textContent=photo.title||'Custom image';
  $('artistCredit').textContent=photo.author;$('artistCredit').href=photo.page;$('artistCredit').title=`Photo by ${photo.author}`;
  $('artistLicense').textContent=photo.license||'SOURCE';$('artistLicense').href=photo.licenseUrl||photo.page||photo.url;
  if(photo.author){$('photoStatus').textContent=`Now showing ${photo.title}. Photo by ${photo.author}; ${photo.license}.`}
}
function nextPhoto(){const photos=allPhotos();if(!photos.length)return;photoPosition=(photoPosition+1)%photos.length;showPhoto(photos[photoPosition])}
function startPhotoRotation(){clearInterval(photoTimer);photoTimer=setInterval(nextPhoto,settings.photoSeconds*1000)}
function initSettings(){
  syncSettings();
  $('fontSize').addEventListener('input',e=>{settings.fontSize=Number(e.target.value);localStorage.setItem('keylight-font-size',String(settings.fontSize));syncSettings()});
  $('passScore').addEventListener('input',e=>{settings.passScore=Number(e.target.value);localStorage.setItem('keylight-pass-score',String(settings.passScore));syncSettings()});
  $('photoSeconds').addEventListener('input',e=>{settings.photoSeconds=Number(e.target.value);localStorage.setItem('keylight-photo-seconds',String(settings.photoSeconds));syncSettings();startPhotoRotation()});
  $('sfxToggle').addEventListener('click',()=>setSound(!settings.sound));
  $('musicToggle').addEventListener('click',()=>setMusic(!settings.music));
  $('resetLevel').addEventListener('click',()=>{index=0;charPos=0;score=0;correct=0;attempts=0;streak=0;paused=false;draw();toast('Fresh start. You’ve got this!')});
  if(settings.music)setMusic(true);
}
$('nextLevel').addEventListener('click',()=>{if(level<levels.length-1&&score>=possibleScore()*settings.passScore/100){level++;index=0;charPos=0;score=0;correct=0;attempts=0;streak=0;draw()}else if(level<levels.length-1)toast(`Reach ${settings.passScore}% score to unlock next`);else{toast('You completed every level! Amazing work!');level=0;index=0;charPos=0;score=0;correct=0;attempts=0;streak=0;draw()}});
$('pauseButton').addEventListener('click',()=>{paused=!paused;draw();toast(paused?'Practice paused':'Back in the flow')});
document.addEventListener('keydown',e=>{if(e.ctrlKey||e.metaKey||e.altKey)return;if(e.key==='Escape'){paused=!paused;draw();toast(paused?'Practice paused':'Back in the flow');return}if(e.key.length===1&& !e.target.matches('input,textarea,select,button,a,[contenteditable="true"]')){e.preventDefault();handle(e.key)}});
buildKeyboard();initSettings();draw();nextPhoto();startPhotoRotation();

