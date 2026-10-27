const tg = window.Telegram?.WebApp;
tg?.ready(); tg?.expand();
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let state={coins:0,totalEarned:0,clickPower:1,autoLevel:0,multiplierLevel:0,streak:0};
let toastTimer;
const fmt=n=>Number(n||0).toLocaleString("ru-RU");
function toast(msg){const el=$("#toast");el.textContent=msg;el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),2300)}
function headers(){return {"Content-Type":"application/json","X-Telegram-Init-Data":tg?.initData||""}}
async function api(path,options={}){const r=await fetch(path,{...options,headers:{...headers(),...(options.headers||{})}});const data=await r.json();if(!r.ok)throw new Error(data.error||"Ошибка");return data}
function render(){ $("#coins").textContent=fmt(state.coins);$("#earned").textContent=fmt(state.totalEarned);$("#profileEarned").textContent=fmt(state.totalEarned);$("#power").textContent=fmt(state.clickPower*(1+state.multiplierLevel));$("#autoRate").textContent=fmt(state.autoLevel);$("#streak").textContent=state.streak;$("#level").textContent=`LVL ${Math.max(1,Math.floor(Math.sqrt(state.totalEarned/100))+1)}`;
 $$(".upgrade").forEach(el=>{const key=el.dataset.upgrade,base={click:50,auto:250,multiplier:1000}[key],factor={click:1.65,auto:1.8,multiplier:2.1}[key],lvl=key==="click"?state.clickPower-1:key==="auto"?state.autoLevel:state.multiplierLevel;const cost=Math.floor(base*Math.pow(factor,lvl));el.querySelector(".price").textContent=fmt(cost);el.querySelector(".buy").disabled=state.coins<cost;el.querySelector(".buy").textContent=lvl>=({click:100,auto:50,multiplier:25}[key])?"MAX":"Купить";});
}
function apply(s){state={...state,...s};render()}
async function refresh(){try{apply(await api("/api/state"))}catch(e){if(tg?.initData)toast(e.message);else toast("Открой игру через Telegram-бота")}}
$("#cookieButton").addEventListener("click",async e=>{const cookie=$("#cookie");cookie.classList.remove("hit");void cookie.offsetWidth;cookie.classList.add("hit");const rect=$("#cookieButton").getBoundingClientRect();const f=document.createElement("span");f.className="float-text";f.textContent=`+${fmt(state.clickPower*(1+state.multiplierLevel))}`;f.style.left=(e.clientX?e.clientX-rect.left:rect.width/2)+"px";f.style.top=(e.clientY?e.clientY-rect.top:rect.height/2)+"px";$("#cookieButton").appendChild(f);setTimeout(()=>f.remove(),850);try{apply(await api("/api/click",{method:"POST",body:"{}"}))}catch(err){toast(err.message)}});
$("#cookieButton").addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();$("#cookieButton").click()}});
$$(".tab").forEach(btn=>btn.addEventListener("click",()=>{$$(".tab").forEach(b=>b.classList.toggle("active",b===btn));["shop","top","profile"].forEach(id=>$("#"+id).classList.toggle("hidden",id!==btn.dataset.tab));if(btn.dataset.tab==="top")loadLeaderboard()}));
$$(".buy").forEach(btn=>btn.addEventListener("click",async()=>{const key=btn.closest(".upgrade").dataset.upgrade;try{const s=await api("/api/buy",{method:"POST",body:JSON.stringify({upgrade:key})});apply(s);toast("✨ Улучшение куплено!")}catch(e){toast(e.message)}}));
async function loadLeaderboard(period="week"){try{const rows=await api("/api/leaderboard?period="+period);$("#leaderboard").innerHTML=rows.length?rows.map(r=>`<div class="leader-row"><div class="rank ${r.rank<=3?["","gold","silver","bronze"][r.rank]:""}">${r.rank<=3?["","🥇","🥈","🥉"][r.rank]:r.rank}</div><div class="leader-name">${escapeHtml(r.name)}</div><div class="score">◉ ${fmt(r.score)}</div></div>`).join(""):'<div class="empty">Пока здесь тихо. Стань первым! 🍪</div>'}catch(e){$("#leaderboard").innerHTML='<div class="empty">Рейтинг доступен после запуска через Telegram.</div>'}}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
$$(".period").forEach(b=>b.addEventListener("click",()=>{$$(".period").forEach(x=>x.classList.toggle("active",x===b));loadLeaderboard(b.dataset.period)}));
$("#daily").addEventListener("click",async()=>{try{const s=await api("/api/daily",{method:"POST",body:"{}"});apply(s);toast(`🎁 +${fmt(s.gained)} монет!`)}catch(e){toast(e.message)}});
setInterval(async()=>{if(state.autoLevel>0){try{apply(await api("/api/click",{method:"POST",body:"{}"}))}catch(e){}}},1000);
refresh();