// Milestone watch: landmarks within reach in United's next match. Totals come from history/milestones.json (tools/build_milestones.py,
// as of the last finished match when it ran); anything the live feed has played since is added here: this season's apps and goals
// (/api/players), newer results for the runs, the manager's count and the head-to-head, and keepers' clean sheets (line-ups).
// Shown only where the underlying total is solid; apps are skipped for a player the builder flagged. All competitions unless stated.
(function(){
  var P=null, FINISHED=/FT|AET|PEN/;
  function esc(t){return String(t==null?"":t).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
  function ord(n){return n+(["th","st","nd","rd"][n%10>3||Math.floor(n%100/10)===1?0:n%10])}
  function yr(d){return d.slice(0,4)}
  function mon(d){return new Date(d+"T12:00:00Z").toLocaleDateString("en-GB",{month:"short",year:"numeric",timeZone:"UTC"})}
  function span(fr,to){var a=mon(fr),b=mon(to); return a===b?a:(yr(fr)===yr(to)?a.split(" ")[0]+"–"+b:a+" – "+b)}
  var APPS=function(n){return n>=50&&n%50===0}, GOALS=function(n){return [10,20,25,50,75].indexOf(n)>=0||(n>=100&&n%25===0)}, CS=function(n){return [10,25,50,75].indexOf(n)>=0||(n>=100&&n%25===0)};
  var MEET=function(n){return n>=25&&n%25===0}, WINS=function(n){return n===10||(n>=25&&n%25===0)}, MGR=function(n){return n>=50&&n%50===0};
  function pl(t){return "/manutd/player/?p="+encodeURIComponent(t)}
  function feedRows(fx){ // finished competitive United matches from the feed, oldest first
    return fx.filter(function(m){return FINISHED.test(m.fixture.status.short)&&!/riendl/.test(m.league.name)}).map(function(m){var home=m.teams.home.id===MU.TEAM, o=home?m.teams.away:m.teams.home;
      return {d:m.fixture.date.slice(0,10),id:m.fixture.id,h:home,oid:o.id,o:o.name,gf:home?m.goals.home:m.goals.away,ga:home?m.goals.away:m.goals.home,lg:m.league.name,sh:/Community Shield|Super Cup/.test(m.league.name)}}).sort(function(a,b){return a.d<b.d?-1:1})}
  function allPlayers(){ // this season's feed totals, every page
    return MU.api("players",{page:1}).then(function(j){var n=j.paging&&j.paging.total||1, ps=[Promise.resolve(j)]; for(var i=2;i<=Math.min(n,5);i++)ps.push(MU.api("players",{page:i})); return Promise.all(ps)}).then(function(js){
      var T={}; js.forEach(function(j){(j.response||[]).forEach(function(x){var a=0,g=0; x.statistics.forEach(function(s){if(s.team.id===MU.TEAM&&!/riendl/.test(s.league.name)){a+=s.games.appearences||0; g+=s.goals.total||0}}); T[x.player.id]={a:a,g:g}})}); return T}).catch(function(){return {}})}
  // ---- each kind of milestone returns items {need, score, unit, t (html), s (sub), href}
  function playerItems(D,T,newCS){
    var out=[];
    D.players.forEach(function(p){
      var f=T[p.fid]||{a:0,g:0}, a1=Math.max(p.apps1,f.a), g1=Math.max(p.g1,f.g), name=esc(p.n);
      if(!a1)return;   // not played this season: leave him out
      if(p.apps0!=null){var A=p.apps0+a1;
        for(var k=1;k<=3;k++)if(APPS(A+k))out.push({need:k,unit:k>1?"apps":"app",score:A+k,href:pl(p.t),t:k===1?name+"’s next appearance will be his "+ord(A+k)+" for United":name+" is "+k+" appearances from "+(A+k)+" for United",s:A+" in all competitions, "+a1+" this season"});
        D.apps.forEach(function(y){ if(y[0]===p.t||y[2]<250)return; var k=y[2]+1-A; if(k>=1&&k<=3)out.push({need:k,unit:k>1?"apps":"app",score:y[2]/4,href:pl(p.t),t:name+" is "+k+" appearance"+(k>1?"s":"")+" from passing "+esc(y[1])+" ("+y[2]+") for United games played",s:A+" in all competitions · counts from the squad lists, 1993/94 on"}) });
      }
      if(!p.gaps){var G=p.g0+g1;
        for(var k2=1;k2<=2;k2++)if(GOALS(G+k2))out.push({need:k2,unit:k2>1?"goals":"goal",score:(G+k2)*2,href:pl(p.t),t:name+" needs "+k2+" goal"+(k2>1?"s":"")+" for "+(G+k2)+" for United",s:G+" in all competitions, "+g1+" this season"});
        var L=D.goals, low=L.length?L[L.length-1][2]:1e9;
        for(var k3=1;k3<=2;k3++){var N=G+k3; if(N<low)continue;
          L.forEach(function(y){ if(y[0]===p.t||y[2]!==N-1||y[3])return;
            var above=L.filter(function(z){return z[0]!==p.t&&z[2]>N}).length, shaky=L.some(function(z){return z[0]!==p.t&&z[3]&&z[2]<N&&z[2]+z[3]>=N}), rank=above+1, tie=L.some(function(z){return z[0]!==p.t&&z[2]===N});
            if(rank>30)return;
            out.push({need:k3,unit:k3>1?"goals":"goal",score:120-rank,href:"/manutd/history/records/#scorers",t:name+" is "+k3+" goal"+(k3>1?"s":"")+" from passing "+esc(y[1])+" ("+y[2]+")"+(shaky?"":" into "+(tie?"joint ":"")+ord(rank)+" on United’s all-time list"),s:G+" in all competitions"});
          });}
      }
      if(p.cs!=null){var C=p.cs+(newCS[p.fid]||0); for(var k4=1;k4<=2;k4++)if(CS(C+k4))out.push({need:k4,unit:k4>1?"clean sheets":"clean sheet",score:C+k4,href:pl(p.t),t:k4===1?"A clean sheet would be "+name+"’s "+ord(C+k4)+" for United":name+" is "+k4+" clean sheets from "+(C+k4)+" for United",s:C+" in "+(p.apps0+a1)+" games, all competitions (started and finished, nothing conceded)"});}
    });
    return out;
  }
  function managerItems(D,newRows){
    var m=D.manager; if(!m)return []; var p=m.p+newRows.length, out=[], prev=m.earlier.reduce(function(s,e){return s+e.p},0), href="/manutd/manager/?m="+encodeURIComponent(m.slug);
    for(var k=1;k<=3;k++){
      if(MGR(p+k))out.push({need:k,unit:k>1?"games":"game",score:90,href:href,t:k===1?esc(m.name)+"’s "+ord(p+k)+" game in charge":esc(m.name)+" is "+k+" games from "+(p+k)+" in charge",s:p+" since "+mon(m.from_)+", all competitions"});
      if(prev&&MGR(p+prev+k))out.push({need:k,unit:k>1?"games":"game",score:85,href:href,t:k===1?esc(m.name)+"’s "+ord(p+prev+k)+" game in charge, counting earlier spells":esc(m.name)+" is "+k+" games from "+(p+prev+k)+" in charge, counting earlier spells",s:p+" in this spell, "+prev+" before"});
    }
    return out;
  }
  var KIND={winning:{ok:function(r){return r.gf>r.ga},pos:1},unbeaten:{ok:function(r){return r.gf>=r.ga},pos:1},scoring:{ok:function(r){return r.gf>0},pos:1},cleansheets:{ok:function(r){return r.ga===0},pos:1},
            winless:{ok:function(r){return r.gf<=r.ga}},losing:{ok:function(r){return r.gf<r.ga}},goalless:{ok:function(r){return r.gf===0}}};
  var SCOPE={all:[function(){return true}," in all competitions"],home:[function(r){return r.h}," at home"],away:[function(r){return !r.h}," away from home"],league:[function(r){return /Premier League/.test(r.lg)}," in the league"]};
  function runItems(D,newRows,next){
    var scopes=["all",next.home?"home":"away"].concat(/Premier League/.test(next.lg)?["league"]:[]), best={};
    scopes.forEach(function(sc){Object.keys(KIND).forEach(function(k){
      var R=D.runs[sc+":"+k]; if(!R)return; var cur=R.cur, fr=R.fr, lastD=R.to||null, stair=R.stair.slice();
      newRows.filter(function(r){return !r.sh&&SCOPE[sc][0](r)}).forEach(function(r){ if(KIND[k].ok(r)){if(!cur)fr=r.d; cur++; lastD=r.d} else {if(cur){stair=[[cur,fr,lastD||fr]].concat(stair.filter(function(x){return x[0]>cur}))} cur=0; lastD=null} });
      if(cur<3)return; var T=cur+1, hit=stair.filter(function(x){return x[0]>=T})[0], rec=stair.length?stair[stair.length-1]:null, score, tail;
      if(!hit){score=200; tail="a club record"+(rec?" (the old one: "+rec[0]+", "+span(rec[1],rec[2])+")":"")}
      else if(hit===rec&&hit[0]===T){score=150; tail="equalling the club record ("+span(hit[1],hit[2])+")"}
      else{var y=new Date().getFullYear()-parseInt(hit[2],10); if(y<10)return; score=y; tail="the longest since "+yr(hit[2])+" ("+hit[0]+", "+span(hit[1],hit[2])+")"}
      var s=SCOPE[sc][1], t;
      if(k==="winning")t="A win would make it "+T+" in a row"+s+": "+tail;
      else if(k==="unbeaten")t="Avoid defeat and it’s "+T+" unbeaten"+s+": "+tail;
      else if(k==="scoring")t="Score and it’s "+T+" games in a row with a goal"+s+": "+tail;
      else if(k==="cleansheets")t="Another clean sheet would be "+T+" in a row"+s+": "+tail;
      else t=(k==="winless"?cur+" games without a win":k==="losing"?cur+" defeats in a row":cur+" games without a goal")+s+". "+(k==="winless"?"Another":k==="losing"?"A "+ord(T)+" defeat":"Another blank")+" would be "+tail;
      var it={need:1,unit:"next",score:score,href:"/manutd/history/records/#runs",t:t,s:"Run so far: "+cur+" since "+MU.fmtDate(fr+"T12:00:00Z",{weekday:undefined,year:"numeric"})+(sc!=="all"?"":" · Shields left out")};
      if(!best[k]||best[k].score<score)best[k]=it;
    })});
    return Object.keys(best).map(function(k){return best[k]});
  }
  function h2hItems(C,newRows,next){
    var name=C.name, M=C.matches.concat(newRows.filter(function(r){return r.oid===next.oid&&r.d>C.last}).map(function(r){return {d:r.d,h:r.h,gf:r.gf,ga:r.ga,c:r.sh?"CS":"X"}})), out=[], href="/manutd/club/?c="+encodeURIComponent(name), N=esc(name);
    var comp=M.filter(function(m){return m.c!=="CS"&&m.c!=="SC"}), W=comp.filter(function(m){return m.gf>m.ga}).length;
    if(MEET(M.length+1))out.push({need:1,unit:"next",score:50,href:href,t:"United’s "+ord(M.length+1)+" meeting with "+N,s:"Every competitive meeting since "+yr(M[0].d)});
    if(WINS(W+1))out.push({need:1,unit:"next",score:60,href:href,t:"A win would be United’s "+ord(W+1)+" over "+N,s:W+" wins in "+comp.length+" meetings (Shields left out)"});
    var V=comp.filter(function(m){return !m.n&&!!m.h===!!next.home}), where=next.home?"at home to ":"away to ", wins=V.filter(function(m){return m.gf>m.ga});
    if(V.length>=3){
      if(!wins.length)out.push({need:1,unit:"next",score:100,href:href,t:"A win would be United’s first ever "+where+N,s:V.length+" "+(next.home?"home":"away")+" meetings, no wins"});
      else if(wins.length===V.length)out.push({need:1,unit:"next",score:30,href:href,t:"United have won all "+V.length+" "+(next.home?"home":"away")+" games against "+N+"; a win makes it "+(V.length+1)+" from "+(V.length+1),s:"Every competitive meeting since "+yr(V[0].d)});
      else{var lw=wins[wins.length-1], since=V.filter(function(m){return m.d>lw.d}).length, y=new Date().getFullYear()-parseInt(lw.d,10);
        if(y>=8&&since>=2)out.push({need:1,unit:"next",score:20+y,href:href,t:"A win would be United’s first "+where+N+" since "+mon(lw.d),s:since+" "+(next.home?"home":"away")+" meetings since then without a win"});}
    }
    var drought=0; for(var i=comp.length-1;i>=0&&!(comp[i].gf>comp[i].ga);i--)drought++;
    if(drought>=5&&drought<comp.length)out.push({need:1,unit:"next",score:drought*3,href:href,t:"A win would end a run of "+drought+" meetings without beating "+N,s:"Last win: "+mon(comp[comp.length-drought-1].d)});
    return out;
  }
  function gkSheets(D,newRows){ // clean sheets in matches the builder hadn't seen: the starting keeper, not substituted
    var keepers=D.players.filter(function(p){return p.cs!=null}).map(function(p){return p.fid}), want=newRows.filter(function(r){return r.ga===0&&!r.sh});
    if(!keepers.length||!want.length)return Promise.resolve({});
    return Promise.all(want.map(function(r){return MU.api("match",{fixture:r.id}).then(function(j){var f=j.response&&j.response[0]; if(!f)return null; var lu=(f.lineups||[]).filter(function(t){return t.team.id===MU.TEAM})[0]; if(!lu)return null;
      var gk=lu.startXI.filter(function(x){return x.player.pos==="G"})[0], id=gk&&gk.player.id, off=(f.events||[]).some(function(e){return e.type==="subst"&&e.team.id===MU.TEAM&&(e.player.id===id||(e.assist&&e.assist.id===id))}); return off?null:id}).catch(function(){return null})}))
      .then(function(ids){var o={}; ids.forEach(function(id){if(id&&keepers.indexOf(id)>=0)o[id]=(o[id]||0)+1}); return o});
  }
  // ---- public: build(next) -> Promise of {items, next, asof}; render(el, next) draws the card body
  function build(next){
    if(!P)P=fetch("/manutd/history/milestones.json").then(function(r){if(!r.ok)throw new Error(r.status);return r.json()});
    return Promise.all([P,MU.api("fixtures").catch(function(){return {response:[]}}),allPlayers()]).then(function(r){
      var D=r[0], rows=feedRows(r[1].response||[]), newRows=rows.filter(function(x){return x.d>D.asof});
      if(!next){var up=(r[1].response||[]).filter(function(m){return !FINISHED.test(m.fixture.status.short)&&!/riendl|CANC|PST/.test(m.league.name+" "+m.fixture.status.short)}).sort(function(a,b){return a.fixture.timestamp-b.fixture.timestamp})[0]; if(!up)return {items:[],next:null,asof:D.asof}; next=up}
      var home=next.teams.home.id===MU.TEAM, o=home?next.teams.away:next.teams.home, N={home:home,oid:o.id,o:o.name,lg:next.league.name,ko:next.fixture.date,id:next.fixture.id}, club=D.opps[String(o.id)];
      return Promise.all([club?fetch("/manutd/history/clubs/"+club.slug+".json").then(function(x){return x.ok?x.json():null}).catch(function(){return null}):null,gkSheets(D,newRows)]).then(function(rr){
        var items=playerItems(D,r[2],rr[1]).concat(managerItems(D,newRows),runItems(D,newRows,N),rr[0]?h2hItems(rr[0],newRows,N):[]);
        items.sort(function(a,b){return a.need-b.need||b.score-a.score});
        return {items:items,next:N,club:club,asof:newRows.length?newRows[newRows.length-1].d:D.asof};
      });
    });
  }
  function row(it){return '<li><a href="'+it.href+'"><span class="mn"><b>'+(it.unit==="next"?"Next":it.need)+'</b>'+(it.unit==="next"?"game":esc(it.unit))+'</span><span class="mt">'+it.t+'<small>'+esc(it.s)+'</small></span></a></li>'}
  function render(el,next,opt){
    opt=opt||{}; if(!el)return;
    build(next).then(function(R){
      var it=R.items, n=R.next, head=n?(n.home?"United v "+esc(n.o):esc(n.o)+" v United")+" · "+MU.fmtDate(n.ko):"";
      if(opt.hideEmpty&&!it.length){el.hidden=true;return}
      el.hidden=false; el.removeAttribute("aria-busy");
      var top=it.slice(0,5), rest=it.slice(5);
      el.querySelector(".msbody").innerHTML=(n?'<p class="sub msfor">Before '+head+'</p>':'')+
        (it.length?'<ul class="ms">'+top.map(row).join("")+'</ul>'+(rest.length?'<ul class="ms" hidden>'+rest.map(row).join("")+'</ul><button class="btn ghost msmore" type="button" aria-expanded="false">'+rest.length+' more</button>':''):'<p class="sub">Nothing within reach'+(n?' before '+head:'')+'.</p>')+
        '<p class="sub msnote">All competitions unless stated. Totals to '+MU.fmtDate(R.asof+"T12:00:00Z",{weekday:undefined})+'; apps from the season squad lists (1993/94 on), goals from every scorer in the archive.</p>';
      var b=el.querySelector(".msmore"); if(b)b.addEventListener("click",function(){var u=el.querySelectorAll("ul.ms")[1], open=u.hidden; u.hidden=!open; b.setAttribute("aria-expanded",open); b.textContent=open?"Fewer":rest.length+" more"});
    }).catch(function(){ if(opt.hideEmpty){el.hidden=true;return} el.querySelector(".msbody").innerHTML='<p class="sub">Milestones unavailable right now.</p>' });
  }
  window.MUMiles={build:build,render:render};
})();
