(function(){
  /* POST-FIRST extractor.
     v1 walked from emails outward, so any post without an email was discarded
     (~85% of everything scrolled). This walks from POSTS and pulls every contact
     channel out of each one: email, phone, WhatsApp, Google Form, ATS link,
     lnkd.in shortlink -- plus the post URL, which v1 never captured.
     Nothing is dropped. Bad categories are FLAGGED so filtering happens later. */

  var RX = {
    email : /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g,
    phone : /(?:\+91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/g,
    wa    : /(wa\.me\/\d+|api\.whatsapp\.com\/send[^\s]*|whats\s?app[:\s]*\+?\d[\d\s-]{7,})/ig,
    form  : /(forms\.gle\/[A-Za-z0-9]+|docs\.google\.com\/forms\/[^\s)"']+)/ig,
    ats   : /((?:jobs\.)?lever\.co\/[^\s)"']+|boards\.greenhouse\.io\/[^\s)"']+|[a-z0-9-]+\.myworkdayjobs\.com[^\s)"']*|[a-z0-9-]+\.keka\.com[^\s)"']*|[a-z0-9-]+\.darwinbox\.in[^\s)"']*|zohorecruit\.com[^\s)"']*|smartrecruiters\.com\/[^\s)"']+|naukri\.com\/job[^\s)"']*)/ig,
    lnkd  : /lnkd\.in\/[A-Za-z0-9_-]+/ig,
    urn   : /urn:li:activity:(\d+)/
  };

  /* widened - v1 required literal titles like "ai engineer" and binned
     38 of 67 posts that plainly said "large-scale AI" or "automation" */
  var CORE = /(ai\b|a\.i\.|artificial intelligence|machine learning|ml\b|mle\b|data scien|generative ai|gen ?ai|genai|llm|nlp|natural language|computer vision|deep learning|mlops|neural|transformer|langchain|pytorch|tensorflow|hugging ?face|embedding|vector db|vector database|rag\b|prompt engineer|fine-?tun)/i;
  var ADJ  = /(data engineer|data analyst|analytics|python developer|software engineer|business analyst|etl|pyspark|databricks|snowflake|full ?stack|backend|power bi|tableau)/i;
  var HARD = /(video editor|graphic design|social media manager|copywriter|shopify|wordpress|ui\/ux|content writer|sales executive|business development executive|hr executive|seo specialist|telecaller|bpo)/i;

  var SEEKER  = /(looking for (?:a |an |new )?(?:job|role|opportunit)|open to work|actively seeking|seeking (?:a |an |new )?(?:job|role|opportunit)|if you know of|kindly refer|please refer|my resume is attached|i am looking|referral or share|would be grateful|open for opportunit|#opentowork)/i;
  var USROLE  = /(\bUSC\b|\bGC[- ]?EAD\b|\bH1B\b|\bH-1B\b|\bH4[- ]?EAD\b|\bOPT[- ]?EAD\b|green card|us citizen|authorized to work in the us|w2 only|\bc2c\b|corp to corp|\bonsite\b.*\b(?:CT|NJ|TX|NY|CA|GA|IL)\b)/i;
  var CERTMILL= /(receive \d+ certificates?|internship certificate|unpaid internship|course fee|enroll now|training program with|we provide training|bootcamp|placement guarantee|earn a certificate)/i;
  var NONTECH = /(real estate|insurance agent|labor law|microsoft office|front desk|receptionist|field sales|delivery partner)/i;

  var BADDOM = /(linkedin|licdn|example|sentry|wixpress|schema|googleapis|gstatic|doubleclick|w3)\./i;

  var Q = new URLSearchParams(location.search).get('keywords') || '';
  var S = { recs:{}, tick:0, flat:0, last:-1, t0:Date.now(), maxPosts:0, posts:0, done:0, q:Q };
  window.__H2 = S;

  function store(){ try { return JSON.parse(localStorage.getItem('__ctx2')||'{}'); } catch(e){ return {}; } }
  function save(d){ try { localStorage.setItem('__ctx2', JSON.stringify(d)); } catch(e){} }
  function uniq(a){ var s={},o=[]; a.forEach(function(x){ if(!s[x]){s[x]=1;o.push(x);} }); return o; }

  /* textContent glues adjacent nodes with no space, so "x@gmail.com" followed
     by "please DM" becomes "x@gmail.complease". Only cut when a real TLD is
     followed by bare letters -- "a@b.co.in" is left alone because the trailing
     run contains a dot. */
  function unglue(e){
    /* also 'x@inapp.com.kindly' -- real TLD, then a dot, then a word */
    e = e.replace(/^([^@]+@[A-Za-z0-9-]+\.(?:com|in|org|net|io|ai|edu))\.[a-z]{3,}$/i, '$1');
    var m = e.match(/^([^@]+@[A-Za-z0-9.-]*?\.(?:com|in|org|net|io|ai|co|edu|info|biz|me|dev|tech))([a-z]{2,})$/i);
    var r = m ? m[1] : e;
    /* "gmail.comi" cuts to gmail.co because "com"+"i" fails the 2-char rule.
       Free providers are unambiguous, so repair them by name. */
    return r.replace(/@(gmail|outlook|yahoo|hotmail)\.c(o?)$/i, '@$1.com');
  }
  function grab(t,re){ re.lastIndex=0; return uniq(t.match(re)||[]); }

  /* Find distinct post containers via author links, keep the smallest ancestor.
     Dedupe by urn:li:activity, NOT by DOM containment: the old contains()
     filter was O(n^2) -- ~250k DOM calls per tick at 500 links, which janked
     scrolling and cost us posts. Marker is tick-scoped so the per-tick count
     stays honest for plateau detection. */
  function postContainers(){
    var byKey={}, out=[];
    /* Company pages post as many hiring ads as people do (measured: 127 company
       links vs 148 person links on one results page). Anchoring on /in/ alone
       made ~46% of posts invisible. */
    var links=document.querySelectorAll('a[href*="/in/"],a[href*="/company/"]');
    for(var i=0;i<links.length;i++){
      var el=links[i], d=0, best=null;
      while(el && d<18){
        if((el.textContent||'').length>200){ best=el; break; }
        el=el.parentElement; d++;
      }
      if(!best) continue;
      if(best.__h2tick===S.tick) continue;      /* same node via another link */
      best.__h2tick=S.tick;

      var t=(best.textContent||'').replace(/\s+/g,' ').trim();
      var um=(best.innerHTML||'').match(RX.urn);
      var key=um ? um[1] : t.slice(0,80);       /* one post = one urn */

      var prev=byKey[key];
      if(prev){
        if(t.length < (prev.el.textContent||'').length){   /* keep innermost */
          out[prev.i]=best; prev.el=best;
        }
        continue;
      }
      byKey[key]={el:best, i:out.length};
      out.push(best);
    }
    return out;
  }

  function authorOf(pc){
    var L=pc.querySelectorAll('a[href*="/in/"],a[href*="/company/"]');
    function urlOf(h){
      var p=(h.match(/\/in\/([^\/?#]+)/)||[])[1];
      if(p) return {u:'https://www.linkedin.com/in/'+p, slug:p};
      var c=(h.match(/\/company\/([^\/?#]+)/)||[])[1];
      if(c) return {u:'https://www.linkedin.com/company/'+c, slug:c};
      return {u:'', slug:''};
    }
    for(var i=0;i<L.length;i++){
      var t=(L[i].textContent||'').replace(/\s+/g,' ').trim();
      var g=urlOf(L[i].getAttribute('href')||'');
      if(t && t.length>1 && t.length<60 && !/^https?:/.test(t)) return { n:t, u:g.u };
    }
    if(L.length){
      var g0=urlOf(L[0].getAttribute('href')||'');
      return { n: g0.slug.replace(/-[0-9a-z]{6,}$/i,'').split('-').filter(Boolean).slice(0,3).join(' '),
               u: g0.u };
    }
    return {n:'',u:''};
  }

  function harvest(){
    var pcs = postContainers();
    S.posts = pcs.length;
    if(pcs.length > S.maxPosts) S.maxPosts = pcs.length;

    pcs.forEach(function(pc){
      var txt = (pc.textContent||'').replace(/\s+/g,' ').trim();
      if(txt.length < 120) return;

      var html = pc.innerHTML || '';
      var um = html.match(RX.urn) || txt.match(RX.urn);
      var postUrl = um ? 'https://www.linkedin.com/feed/update/urn:li:activity:'+um[1]+'/' : '';

      var emails = grab(txt, RX.email).map(function(e){return unglue(e.toLowerCase());})
                     .filter(function(e){ return !BADDOM.test(e); });
      var phones = grab(txt, RX.phone);
      var was    = grab(txt, RX.wa);
      var forms  = grab(html+' '+txt, RX.form);
      var ats    = grab(html+' '+txt, RX.ats);
      var lnkd   = grab(html+' '+txt, RX.lnkd);

      if(!emails.length && !phones.length && !forms.length && !ats.length && !lnkd.length) return;

      var a = authorOf(pc);
      var tier = CORE.test(txt) ? 'CORE' : (HARD.test(txt) ? 'DROP' : (ADJ.test(txt) ? 'ADJACENT' : 'UNKNOWN'));
      var method = emails.length ? 'email' : (forms.length ? 'form' : (ats.length ? 'ats' :
                   (was.length ? 'whatsapp' : (phones.length ? 'phone' : 'link'))));

      var base = {
        postUrl: postUrl, author: a.n, authorUrl: a.u, tier: tier, method: method,
        phones: phones.join(' | '), whatsapp: was.join(' | '),
        forms: forms.join(' | '), ats: ats.join(' | '), lnkd: lnkd.join(' | '),
        seeker: SEEKER.test(txt)?1:0, usrole: USROLE.test(txt)?1:0,
        certmill: CERTMILL.test(txt)?1:0, nontech: NONTECH.test(txt)?1:0,
        nEmails: emails.length, listicle: emails.length>2?1:0,
        q: Q, text: txt.slice(0,500)   /* 1200 overflowed the 5MB localStorage cap */
      };

      if(emails.length){
        emails.forEach(function(e){
          if(S.recs[e]) return;
          var r={}; for(var k in base) r[k]=base[k];
          r.email=e; S.recs[e]=r;
        });
      } else {
        var key = 'nomail:' + (postUrl || txt.slice(0,60));
        if(!S.recs[key]){ var r2={}; for(var k2 in base) r2[k2]=base[k2]; r2.email=''; S.recs[key]=r2; }
      }
    });
    sweep();
    return Object.keys(S.recs).length;
  }

  /* Safety net. v1 scanned every text node and kept an email even when it could
     not resolve a post container; v2 required one, so emails outside a detected
     container vanished -- 528 unique emails became 179. Post-first stays the
     primary path (it carries author + channels); this guarantees v2 is never a
     subset of v1. Records land flagged orphan=1 so they stay auditable. */
  function sweep(){
    var big = document.body.textContent || '';
    RX.email.lastIndex = 0;
    var m;
    while((m = RX.email.exec(big)) !== null){
      var e = unglue(m[0].toLowerCase());
      if(BADDOM.test(e) || S.recs[e]) continue;
      var win = big.slice(Math.max(0, m.index-700), m.index+150).replace(/\s+/g,' ').trim();
      S.recs[e] = {
        postUrl:'', author:'', authorUrl:'', method:'email',
        tier: CORE.test(win)?'CORE':(HARD.test(win)?'DROP':(ADJ.test(win)?'ADJACENT':'UNKNOWN')),
        phones:'', whatsapp:'', forms:'', ats:'', lnkd:'',
        seeker: SEEKER.test(win)?1:0, usrole: USROLE.test(win)?1:0,
        certmill: CERTMILL.test(win)?1:0, nontech: NONTECH.test(win)?1:0,
        nEmails:1, listicle:0, orphan:1, email:e, q:Q, text:win.slice(0,500)
      };
    }
  }

  function flush(){
    var d=store(), added=0;
    Object.keys(S.recs).forEach(function(k){ if(!d[k]){ d[k]=S.recs[k]; added++; } });
    save(d); return added;
  }

  harvest();
  S.iv=setInterval(function(){
    S.tick++;
    var m=document.querySelector('main');
    if(m) m.scrollTop=m.scrollHeight;
    window.scrollTo(0,document.body.scrollHeight);
    harvest();
    if(S.tick%10===0) flush();               /* every 10 ticks, not 4 - bigger payload */
    var p=S.posts;
    if(p===S.last){ S.flat++; } else { S.flat=0; S.last=p; }
    /* A slow-loading page reads as "flat" and used to end the query at ~16s
       with 1 post. Never accept a plateau before tick 5 or under 8 posts. */
    var settled = S.tick>=5 && p>=8;
    if((settled && S.flat>=4) || S.tick>=13){ clearInterval(S.iv); flush(); S.done=1; }
  }, 3000);

  return 'started';
})()
