// Where to watch: the official rights holders for the visitor's country (static/manutd/watch.json, from the Premier League's and
// UEFA's own broadcaster lists). Country: the visitor's choice (saved in this browser), else the country the Worker stamps
// as <meta name="mu-country">, else the UK. Rights are by country and season, not by match; the UK's live picks are
// announced month by month, so the line names the possible broadcasters rather than guessing which one has this game.
(function(){
  var KEY="mu:country", DATA=null, P=null;
  function load(){if(!P)P=fetch("/manutd/watch.json").then(function(r){return r.json()}).then(function(j){DATA=j;return j}); return P}
  function country(){var c=null; try{c=localStorage.getItem(KEY)}catch(e){} if(!c){var m=document.querySelector('meta[name="mu-country"]'); c=m&&m.content} return (c||"GB").toUpperCase()}
  function esc(t){return String(t).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
  function compKey(comp){return /premier/i.test(comp||"")?"pl":/champions/i.test(comp||"")?"ucl":null}
  function ukSat3(iso){var d=new Date(iso); return d.toLocaleDateString("en-GB",{weekday:"short",timeZone:"Europe/London"})==="Sat"&&d.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",timeZone:"Europe/London"})==="15:00"}
  function render(el,m){
    var k=compKey(m.comp); if(!el||!k){if(el)el.hidden=true;return}
    load().then(function(J){
      var cc=country(), C=J.countries[cc], src=J.sources[k], checked=new Date(J.checked+"T12:00:00Z").toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
      var opts=Object.keys(J.countries).sort(function(a,b){return J.countries[a].n.localeCompare(J.countries[b].n)}).map(function(c){return '<option value="'+c+'"'+(c===cc?' selected':'')+'>'+esc(J.countries[c].n)+'</option>'}).join("")+'<option value="--"'+(C?'':' selected')+'>Somewhere else</option>';
      var who=C&&C[k], note=C&&C[k+"Note"]||"";
      if(cc==="GB"&&k==="pl"&&m.ko&&ukSat3(m.ko))note="Saturday 3pm kick-off: not shown live in the UK (the 3pm blackout). Highlights on BBC Match of the Day.";
      el.hidden=false;
      el.innerHTML='<div class="wh"><b>Where to watch</b><label><span class="sr">Country</span><select>'+opts+'</select></label></div>'+
        (who?'<p class="wl">'+who.map(function(b){return '<span class="bc">'+esc(b)+'</span>'}).join(" ")+'</p>'+(note?'<p class="sub wn">'+esc(note)+'</p>':''):'<p class="sub wn">Not in our list — see the official list below.</p>')+
        '<p class="sub ws">'+(who&&who.length>1&&!(cc==="GB"&&note.indexOf("blackout")>0)?"Rights holders in "+esc(C.n)+"; which of them shows this match is set nearer the time. ":"")+'From <a href="'+src.u+'" target="_blank" rel="noopener">'+esc(src.t)+'</a>, checked '+checked+'.</p>';
      el.querySelector("select").addEventListener("change",function(e){try{localStorage.setItem(KEY,e.target.value)}catch(x){} render(el,m)});
    }).catch(function(){el.hidden=true});
  }
  window.MUWatch={render:render};
})();
