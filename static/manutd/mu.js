// Shared bits for the Manchester United hub pages.
window.MU=(function(){
  var TEAM=33;
  var NAV=[["/manutd/","Hub"],["/manutd/trips/","Trips"],["/manutd/season/","Season"],["/manutd/squad/","Squad"],["/manutd/history/","History"]];
  function nav(active){
    var el=document.querySelector("nav.munav"); if(!el)return;
    el.innerHTML=NAV.map(function(n){return '<a href="'+n[0]+'"'+(n[1]===active?' aria-current="page"':'')+'>'+n[1]+'</a>'}).join("");
  }
  // GET /api/<name>?..., cached in sessionStorage for 30 min so page hops don't re-hit the Worker.
  function api(name,params){
    var q=params?"?"+Object.keys(params).map(function(k){return k+"="+encodeURIComponent(params[k])}).join("&"):"";
    var url="/api/"+name+q, key="mu:"+url;
    try{var c=JSON.parse(sessionStorage.getItem(key)||"null"); if(c&&Date.now()-c.t<18e5)return Promise.resolve(c.v)}catch(e){}
    return fetch(url).then(function(r){return r.json()}).then(function(j){
      if(j.errors&&Object.keys(j.errors).length){var e=new Error(JSON.stringify(j.errors)); e.api=true; throw e}
      if(j.message)throw Object.assign(new Error(j.message),{api:true});
      try{sessionStorage.setItem(key,JSON.stringify({t:Date.now(),v:j}))}catch(e){}
      return j;
    });
  }
  function apiDown(el,err){
    if(!el)return;
    el.innerHTML='<div class="empty"><b>Live data not connected yet.</b> This section fills from API-Football once the Worker key is active'+(err&&err.message?' <span style="opacity:.7">('+String(err.message).slice(0,120)+')</span>':'')+'.</div>';
  }
  var ISO={"England":"gb-eng","Scotland":"gb-sct","Wales":"gb-wls","Northern Ireland":"gb-nir","Portugal":"pt","Brazil":"br","Netherlands":"nl","Argentina":"ar","Morocco":"ma","Turkey":"tr","Türkiye":"tr","Denmark":"dk","France":"fr","Cameroon":"cm","Uruguay":"uy","Slovenia":"si","Belgium":"be","Paraguay":"py","Cote d'Ivoire":"ci","Ivory Coast":"ci","Spain":"es","Germany":"de","Italy":"it","Sweden":"se","Norway":"no","Republic of Ireland":"ie","Ireland":"ie","Nigeria":"ng","Ghana":"gh","Senegal":"sn","Croatia":"hr","Serbia":"rs","Poland":"pl","Austria":"at","Switzerland":"ch","USA":"us","United States":"us","Canada":"ca","Mexico":"mx","Colombia":"co","Chile":"cl","Ecuador":"ec","Japan":"jp","Korea Republic":"kr","South Korea":"kr","Australia":"au","Egypt":"eg","Algeria":"dz","Tunisia":"tn","Mali":"ml","Guinea":"gn","DR Congo":"cd","Congo DR":"cd","Angola":"ao","Ukraine":"ua","Czech Republic":"cz","Czechia":"cz","Slovakia":"sk","Hungary":"hu","Romania":"ro","Greece":"gr","Finland":"fi","Iceland":"is","Jamaica":"jm","Venezuela":"ve","Peru":"pe","Bosnia and Herzegovina":"ba","Albania":"al","Kosovo":"xk","North Macedonia":"mk","Montenegro":"me","Georgia":"ge","Israel":"il","Iran":"ir","Saudi Arabia":"sa","New Zealand":"nz","Gabon":"ga","Burkina Faso":"bf","Zambia":"zm","Zimbabwe":"zw","South Africa":"za","Uganda":"ug","Kenya":"ke","Luxembourg":"lu","Cyprus":"cy","Malta":"mt","Lithuania":"lt","Latvia":"lv","Estonia":"ee","Bulgaria":"bg","Moldova":"md","Belarus":"by","Russia":"ru","Armenia":"am","Azerbaijan":"az","Kazakhstan":"kz","Uzbekistan":"uz","China PR":"cn","China":"cn","India":"in","Pakistan":"pk","Bangladesh":"bd","Indonesia":"id","Malaysia":"my","Philippines":"ph","Thailand":"th","Vietnam":"vn","Costa Rica":"cr","Panama":"pa","Honduras":"hn","Guatemala":"gt","El Salvador":"sv","Trinidad and Tobago":"tt","Haiti":"ht","Dominican Republic":"do","Cuba":"cu","Bolivia":"bo","Suriname":"sr","Curacao":"cw","Curaçao":"cw","Cape Verde Islands":"cv","Cabo Verde":"cv","Guinea-Bissau":"gw","Sierra Leone":"sl","Liberia":"lr","Togo":"tg","Benin":"bj","Niger":"ne","Chad":"td","Sudan":"sd","Ethiopia":"et","Tanzania":"tz","Mozambique":"mz","Madagascar":"mg","Comoros":"km","Mauritania":"mr","Libya":"ly","Equatorial Guinea":"gq","Central African Republic":"cf","Congo":"cg","Rwanda":"rw","Burundi":"bi","Eritrea":"er","Djibouti":"dj","Somalia":"so","Namibia":"na","Botswana":"bw","Eswatini":"sz","Lesotho":"ls","Malawi":"mw","Gambia":"gm"};
  function flag(nat){var c=ISO[nat]; return c?'<img class="flag" src="https://flagcdn.com/w40/'+c+'.png" srcset="https://flagcdn.com/w80/'+c+'.png 2x" alt="'+nat+'" title="'+nat+'">':''}
  function fmtDate(iso,opt){return new Date(iso).toLocaleDateString("en-GB",Object.assign({weekday:"short",day:"numeric",month:"short",timeZone:"Europe/London"},opt||{}))}
  function fmtUK(iso){return new Date(iso).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",timeZone:"Europe/London"})}
  function fmtSE(iso){return new Date(iso).toLocaleTimeString("sv-SE",{hour:"2-digit",minute:"2-digit",timeZone:"Europe/Stockholm"})}
  function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
  function formHtml(str){return '<span class="form">'+String(str||"").split("").map(function(c){return '<b class="'+c+'">'+c+'</b>'}).join("")+'</span>'}
  return {TEAM:TEAM,nav:nav,api:api,apiDown:apiDown,flag:flag,fmtDate:fmtDate,fmtUK:fmtUK,fmtSE:fmtSE,esc:esc,form:formHtml};
})();
