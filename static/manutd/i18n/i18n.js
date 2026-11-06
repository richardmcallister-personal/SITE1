// Site languages. The Worker loads this in <head> before any content, sets window.MU_LANG (from the visitor's saved
// choice in the mu_lang cookie, else the browser's language if it is one of LANGS, else English), and for a language
// other than English also loads /i18n/<lang>.js, which hands its dictionary to MU_I18N(). Text is then translated as
// the parser and the page scripts put it into the document, so English never flashes up first.
// Dictionary keys are the English text of one text node (spaces collapsed, trimmed). Digits become {0}, {1}… so
// "Matchweek 9" matches "Matchweek {0}". Anything without an entry (names, Wikipedia text, feed text) stays as it is.
// Mark an element translate="no" (or class "notranslate") to keep it out.
(function(){
  var LANGS={en:"English",ga:"Gaeilge",es:"Español",fr:"Français",de:"Deutsch",sv:"Svenska",da:"Dansk"};
  var LOCALE={en:"en-GB",ga:"ga-IE",es:"es-ES",fr:"fr-FR",de:"de-DE",sv:"sv-SE",da:"da-DK"};
  var lang=window.MU_LANG;
  if(!LANGS[lang]){lang="en"; try{var c=(document.cookie.match(/(?:^|;\s*)mu_lang=([a-z]{2})/)||[])[1]; if(LANGS[c])lang=c; else{var nl=navigator.languages||[navigator.language||"en"]; for(var i=0;i<nl.length;i++){var p=String(nl[i]).slice(0,2).toLowerCase(); if(LANGS[p]){lang=p;break}}}}catch(e){}}
  window.MU_LANG=lang;
  document.documentElement.setAttribute("lang",lang==="en"?"en-GB":LOCALE[lang]);

  var D=null, LC=null, NT=[], MISS=Object.create(null), DONE=new WeakMap();
  var NUM=/\d[\d.,:\/–-]*\d|\d/g, ORD=/\b(\d+)(?:st|nd|rd|th)\b/g, MONTHS="jan feb mar apr may jun jul aug sep oct nov dec".split(" "), DATE=/^(?:(\d{1,2}) )?(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?(?: (\d{4}))?$/;
  function norm(s){return String(s).replace(/\s+/g," ").trim()}
  function fill(v,nums){return v.replace(/\{(\d)\}/g,function(_,n){return nums[n]!=null?nums[n]:""})}
  function cased(src,v){return /^[A-Z]/.test(src)&&/^[a-zà-ÿ]/.test(v)?v.charAt(0).toUpperCase()+v.slice(1):/^[a-z]/.test(src)&&/^[A-ZÀ-Þ]/.test(v)&&!/^[A-ZÀ-Þ]{2}/.test(v)?v.charAt(0).toLowerCase()+v.slice(1):v}
  function look(k){
    if(!k)return null;
    if(D[k]!=null)return D[k];
    var lk=LC[k.toLowerCase()]; if(lk!=null)return cased(k,lk);
    var dm=k.match(DATE); if(dm&&(dm[1]||dm[3])){var mi=MONTHS.indexOf(dm[2].slice(0,3).toLowerCase()); if(mi>=0){var dt=new Date(Date.UTC(+(dm[3]||2000),mi,+(dm[1]||1),12)), long=dm[2].length>4; try{return dt.toLocaleDateString("en-GB",{day:dm[1]?"numeric":undefined,month:long?"long":"short",year:dm[3]?"numeric":undefined,timeZone:"UTC"})}catch(e){}}}
    var o=k.replace(ORD,"$1th"), nums=o.match(NUM);
    if(nums){var i=0, tk=o.replace(NUM,function(){return "{"+(i++)+"}"}); if(D[tk]!=null)return fill(D[tk],nums); lk=LC[tk.toLowerCase()]; if(lk!=null)return cased(k,fill(lk,nums))}
    return null;
  }
  // Keys with {N} {M} {P} are sentences built around names or other text: the slot is kept (translated itself when
  // it has an entry), numbers fill {0} {1}…
  function compile(){
    NT=Object.keys(D).filter(function(k){return /\{[NMP]\}/.test(k)}).map(function(k){
      var slots=[], re=k.replace(/[.*+?^$()|[\]\\]/g,"\\$&").replace(/\{([NMP]|\d)\}/g,function(_,x){slots.push(x); return /\d/.test(x)?"(\\d[\\d.,:\\/–-]*\\d|\\d)":"(.+?)"});
      return {re:new RegExp("^"+re+"$"),slots:slots,v:D[k],w:k.replace(/\{[^}]*\}/g,"").length}}).sort(function(a,b){return b.w-a.w});
  }
  var depth=0;
  function named(k){
    if(!NT.length||depth>2)return null;
    var o=k.replace(ORD,"$1th");
    for(var i=0;i<NT.length;i++){var m=o.match(NT[i].re); if(!m)continue;
      var map={}; NT[i].slots.forEach(function(x,j){var g=m[j+1]; if(/[NMP]/.test(x)){depth++; var t=T(g); depth--; if(t!=null){var lead=g.match(/^\s*/)[0], tail=g.match(/\s*$/)[0]; g=lead+t+tail}} map[x]=g});
      return NT[i].v.replace(/\{([NMP]|\d)\}/g,function(_,x){return map[x]!=null?map[x]:""})}
    return null;
  }
  // Translate one string; null when there is no entry. Leading/trailing punctuation and arrows are kept as they are.
  function T(s){
    if(!D)return null;
    var k=norm(s); if(!k||!/[A-Za-z]/.test(k))return null;
    if(k in MISS)return MISS[k];
    var r=look(k), m;
    if(r==null){m=k.match(/^([\s·•(\[–—\-|]*)(.*?)([\s:·•→←↗…).,;!?\]|]*)$/); if(m&&m[2]&&m[2]!==k){var x=look(m[2]); if(x!=null)r=m[1]+x+m[3]}}
    if(r==null){var sep=k.indexOf(" · ")>0?" · ":k.indexOf(", ")>0&&k.length<160?", ":null;
      if(sep){var parts=k.split(sep), n=0; parts=parts.map(function(p){var x=T(p); if(x!=null){n++; return x} return p}); if(n&&(sep===" · "||n===parts.length))r=parts.join(sep)}}
    if(r==null)r=named(k);
    if(r==null&&m&&m[2]&&m[2]!==k){var y=named(m[2]); if(y!=null)r=m[1]+y+m[3]}
    MISS[k]=r; return r;
  }
  function skip(el){return !el||/^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|CODE|PRE)$/.test(el.tagName)||(el.closest&&el.closest("[translate=no],.notranslate"))}
  var ATTRS=["placeholder","aria-label","title","alt"];
  function text(n){
    var v=n.nodeValue, d=DONE.get(n); if(d&&d.v===v&&(d.tr||d.g===GEN))return;
    if(skip(n.parentElement))return;
    var r=T(v), tr=false; if(r!=null){var lead=v.match(/^\s*/)[0], tail=v.match(/\s*$/)[0]; v=lead+r+tail; n.nodeValue=v; tr=true}
    DONE.set(n,{v:v,tr:tr,g:GEN});
  }
  function attrs(el){
    if(skip(el))return;
    for(var i=0;i<ATTRS.length;i++){var a=ATTRS[i], v=el.getAttribute(a); if(!v)continue; var mark="i18n:"+a; if(el[mark]===v)continue; var r=T(v); if(r!=null){el.setAttribute(a,r); v=r} el[mark]=v}
    if(el.tagName==="INPUT"&&/^(button|submit)$/.test(el.type)&&el.value){var r2=T(el.value); if(r2!=null)el.value=r2}
  }
  function walk(root){
    if(root.nodeType===3){text(root);return}
    if(root.nodeType!==1&&root.nodeType!==11)return;
    if(root.nodeType===1){if(skip(root))return; attrs(root)}
    var w=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT,{acceptNode:function(n){return n.nodeType===1&&skip(n)?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT}}), n;
    while((n=w.nextNode())){if(n.nodeType===3)text(n); else attrs(n)}
  }
  var TITLE="";
  function title(){var t=document.title; if(!t||t===TITLE)return; var r=T(t); if(r!=null)document.title=r; TITLE=document.title}

  // Dates: named months and weekdays follow the language; all-numeric formats keep en-GB (some code splits them).
  function patchDates(){
    var L=LOCALE[lang], has=false; try{has=Intl.DateTimeFormat.supportedLocalesOf([L]).length>0}catch(e){}
    function want(loc,opt){return (!loc||/^en/i.test(String(loc)))&&opt&&(opt.weekday||/^(short|long|narrow)$/.test(opt.month||"")||opt.era)}
    // Some browsers (desktop Chrome) carry no Irish date names: format in en-GB and swap the words.
    var GA={January:"Eanáir",February:"Feabhra",March:"Márta",April:"Aibreán",May:"Bealtaine",June:"Meitheamh",July:"Iúil",August:"Lúnasa",September:"Meán Fómhair",October:"Deireadh Fómhair",November:"Samhain",December:"Nollaig",
      Jan:"Ean",Feb:"Feabh",Mar:"Márta",Apr:"Aib",Jun:"Meith",Jul:"Iúil",Aug:"Lún",Sep:"MFómh",Sept:"MFómh",Oct:"DFómh",Nov:"Samh",Dec:"Noll",
      Sunday:"Dé Domhnaigh",Monday:"Dé Luain",Tuesday:"Dé Máirt",Wednesday:"Dé Céadaoin",Thursday:"Déardaoin",Friday:"Dé hAoine",Saturday:"Dé Sathairn",Sun:"Domh",Mon:"Luan",Tue:"Máirt",Wed:"Céad",Thu:"Déar",Fri:"Aoine",Sat:"Sath"};
    var GARE=/\b(January|February|March|April|May|June|July|August|September|October|November|December|Sept|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/g;
    function swap(t){return lang==="ga"?String(t).replace(GARE,function(w){return GA[w]||w}):t}
    var loc2=has?L:"en-GB", conv=has?function(t){return t}:swap;
    ["toLocaleDateString","toLocaleString"].forEach(function(m){var o=Date.prototype[m]; Date.prototype[m]=function(loc,opt){return want(loc,opt)?conv(o.call(this,loc2,opt)):o.call(this,loc,opt)}});
    var DTF=Intl.DateTimeFormat;
    var W=function(loc,opt){var f=new DTF(want(loc,opt)?loc2:loc,opt); if(want(loc,opt)&&!has){var fm=f.format.bind(f), fp=f.formatToParts&&f.formatToParts.bind(f); return {format:function(d){return conv(fm(d))},formatToParts:function(d){return fp(d).map(function(x){return {type:x.type,value:conv(x.value)}})},resolvedOptions:function(){return f.resolvedOptions()}}} return f};
    W.prototype=DTF.prototype; W.supportedLocalesOf=DTF.supportedLocalesOf; Intl.DateTimeFormat=W;
  }

  // Called by /i18n/<lang>.js.
  // <lang>.js carries the interface; <lang>-long.js (longer prose: ground guides, timeline, write-ups) follows async.
  var BASE=((document.currentScript&&document.currentScript.src)||"/i18n/i18n.js").replace(/i18n\.js.*$/,""), GEN=0;
  window.MU_I18N=function(dict){
    if(lang==="en")return; var first=!D; D=D||{}; for(var k in dict)D[k]=dict[k];
    LC=Object.create(null); Object.keys(D).forEach(function(k){if(!/\{[NMP]\}/.test(k))LC[k.toLowerCase()]=D[k]}); compile(); MISS=Object.create(null); GEN++;
    if(document.body)walk(document.body); title();
    if(!first)return;
    patchDates();
    var ls=document.createElement("script"); ls.src=BASE+lang+"-long.js"; ls.async=true; (document.head||document.documentElement).appendChild(ls);
    new MutationObserver(function(ms){
      for(var i=0;i<ms.length;i++){var m=ms[i];
        if(m.type==="childList"){for(var j=0;j<m.addedNodes.length;j++)walk(m.addedNodes[j]); if(m.target.nodeName==="TITLE")title()}
        else if(m.type==="characterData")text(m.target);
        else if(m.type==="attributes")attrs(m.target)}
      title();
    }).observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:ATTRS});
  };
  // For page scripts that build text: MU_T("Next match") → the translation, or the English when there is none.
  window.MU_T=function(s){var r=T(s); return r!=null?r:s};

  // Footer language switch (next to Appearance); the choice is saved in a cookie the Worker reads.
  function setLang(l){try{document.cookie="mu_lang="+l+"; path=/; max-age=31536000; SameSite=Lax"; localStorage.setItem("mu:lang",l)}catch(e){} location.reload()}
  function sw(){var f=document.querySelector("footer.mu"); if(!f||f.querySelector(".langsw"))return;
    var s=document.createElement("select"); s.className="langsw"; s.setAttribute("aria-label","Language"); s.setAttribute("translate","no");
    Object.keys(LANGS).forEach(function(k){var o=document.createElement("option"); o.value=k; o.textContent=LANGS[k]; o.lang=LOCALE[k]; if(k===lang)o.selected=true; s.appendChild(o)});
    s.addEventListener("change",function(){setLang(s.value)});
    var lab=document.createElement("label"); lab.className="langlab"; lab.appendChild(document.createTextNode(" "+(T("Language")||"Language")+": ")); lab.appendChild(s);
    f.appendChild(document.createTextNode(" ·")); f.appendChild(lab)}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",sw); else sw();
})();
