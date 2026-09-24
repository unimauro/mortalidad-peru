/* ===== Observatorio de Mortalidad del Perú ===== */
(() => {
'use strict';
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const fmt = n => (n==null ? '—' : n.toLocaleString('es-PE'));
const fmt1 = n => (n==null ? '—' : Number(n).toLocaleString('es-PE',{maximumFractionDigits:1}));
const MESES = ['','enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const MESES_C = ['','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
// ==== Chatbot IA (gateway ai.tunky.net) ====
// Pega el token del proyecto (formato mortalidad_...) para activar la IA.
// Mientras esté vacío, el asistente responde localmente con los datos del observatorio.
const TUNKY_TOKEN = '';
const TUNKY_URL = 'https://ai.tunky.net/v1/chat';
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');

// ---- tema ----
const THEME_KEY = 'mp-theme';
function currentTheme(){
  const t = document.documentElement.getAttribute('data-theme');
  if (t) return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function cssvar(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function palette(){
  return {
    ink: cssvar('--ink'), soft: cssvar('--ink-soft'), line: cssvar('--line'),
    card: cssvar('--card'), brand: cssvar('--brand'),
    cat: ['--c1','--c2','--c3','--c4','--c5','--c6','--c7','--c8'].map(cssvar),
    up: cssvar('--up'), down: cssvar('--down'), flat: cssvar('--flat')
  };
}
// Por defecto tema CLARO (menos sombrío) aunque el SO esté en oscuro; respeta la elección guardada.
try{ const saved = localStorage.getItem(THEME_KEY); document.documentElement.setAttribute('data-theme', saved || 'light'); }catch(e){ document.documentElement.setAttribute('data-theme','light'); }
$('#themeBtn').onclick = () => {
  const next = currentTheme()==='dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try{ localStorage.setItem(THEME_KEY, next);}catch(e){}
  rerenderAll();
};

// ---- registro de charts ----
const charts = {};           // id -> echarts instance
const builders = [];         // funciones que (re)construyen cada chart
function reg(id, buildFn){ builders.push({id, buildFn}); }
function ec(id){
  if(!charts[id]){ charts[id] = echarts.init($('#'+id), null, {renderer:'canvas'}); }
  return charts[id];
}
function rerenderAll(){ builders.forEach(b => b.buildFn()); }
addEventListener('resize', () => Object.values(charts).forEach(c => c.resize()));

// estilo base para ejes/grid según tema
function baseGrid(){ return {left:8,right:14,top:26,bottom:8,containLabel:true}; }
// grid con espacio arriba para leyenda superior (evita que la leyenda tape los años)
function gridL(){ return {left:8,right:16,top:44,bottom:14,containLabel:true}; }
function legTop(){ const p=palette(); return {top:8,left:'center',type:'scroll',icon:'roundRect',
  itemWidth:14,itemHeight:8,itemGap:14,textStyle:{color:p.soft,fontSize:11}}; }
// banda sombreada para señalar el año en curso (parcial) en las series temporales
function partialBand(){ const p=palette(); const py=String(D.meta.anio_parcial); return {
  silent:true, itemStyle:{color:'rgba(138,143,152,.16)'},
  label:{show:true,formatter:'parcial',color:p.soft,fontSize:9,position:'insideTop'},
  data:[[{xAxis:py},{xAxis:py}]] }; }
function axisStyle(){ const p=palette(); return {
  axisLine:{lineStyle:{color:p.line}}, axisTick:{show:false},
  axisLabel:{color:p.soft,fontSize:11}, splitLine:{lineStyle:{color:p.line,type:'dashed'}}
};}
function tt(extra={}){ const p=palette(); return Object.assign({
  backgroundColor:p.card, borderColor:p.line, borderWidth:1,
  textStyle:{color:p.ink,fontSize:12}, extraCssText:'box-shadow:0 8px 30px rgba(0,0,0,.12);border-radius:10px;'
}, extra);}
function covidBands(){ const p=palette(); return {
  silent:true, symbol:'none', data:[
    [{xAxis:'2020',itemStyle:{color:'transparent'}},{xAxis:'2022'}],
  ], itemStyle:{color:'rgba(211,94,0,.06)'}, label:{show:false}
};}

let D=null, GEO=null, CAUSES=[];

// ================= carga =================
Promise.all([
  fetch('data/processed/datos.json').then(r=>r.json()),
  fetch('assets/peru_departamentos.geojson').then(r=>r.json()).catch(()=>null)
]).then(([data, geo]) => {
  D = data; GEO = geo;
  init();
}).catch(err => {
  console.error(err);
  $('#kpis').innerHTML = '<div class="kpi">No se pudieron cargar los datos. Reintenta.</div>';
});

const YEARS = () => D.meta.anios.map(String);
const FULL  = () => D.meta.anios_completos.map(String);
const PARTIAL = () => String(D.meta.anio_parcial);
const lastFull = () => FULL()[FULL().length-1];

function lastMonthYear(){
  const yrs = Object.keys(D.mensual_sexo).filter(y=>Object.keys(D.mensual_sexo[y]).length).sort();
  const ly = yrs[yrs.length-1];
  const lm = Object.keys(D.mensual_sexo[ly]).sort();
  return {year: ly, month: +lm[lm.length-1]};
}
function init(){
  // cobertura de datos
  const lm = lastMonthYear();
  $('#dataSpan').textContent = `enero ${YEARS()[0]} – ${MESES[lm.month]} ${lm.year}`;
  buildKPIs();
  buildMethods();
  fillSelectors();
  // registrar y construir
  reg('ch_general', chGeneral);
  reg('ch_top', chTop);
  reg('ch_bump', chBump);
  reg('ch_meta', chMeta);
  reg('ch_crim', chCrim);
  reg('ch_crimSexo', chCrimSexo);
  reg('ch_acc', chAcc);
  reg('ch_pyr', chPyr);
  reg('ch_map', chMap);
  reg('ch_cancer', chCancer);
  reg('ch_cancerTrend', chCancerTrend);
  reg('ch_vih', chVih);
  reg('ch_month', chMonth);
  reg('ch_hero', chHero);
  reg('ch_crimEdad', chCrimEdad);
  reg('ch_hommes', chHomMes);
  reg('ch_oficial', chOficial);
  rerenderAll();
  wireControls();
  buildSemaforo();
  wireCSV();
  wireChat();
  wireNav();
}

// ================= KPIs =================
function ejeSum(year, eje){
  return (D.causas_por_anio[year]||[]).filter(c=>c.eje===eje).reduce((a,c)=>a+c.n,0);
}
function animateVal(el, val, suffix=''){
  const dur=900, t0=performance.now(); const from=0;
  function step(t){ const k=Math.min(1,(t-t0)/dur); const e=1-Math.pow(1-k,3);
    el.textContent = fmt(Math.round(from+(val-from)*e))+suffix; if(k<1) requestAnimationFrame(step);}
  requestAnimationFrame(step);
}
function chip(pct){
  if(pct==null) return '';
  const cls = pct>1?'up':(pct<-1?'down':'flat');
  const arr = pct>1?'▲':(pct<-1?'▼':'▬');
  return `<span class="chip ${cls}">${arr} ${fmt1(Math.abs(pct))}%</span>`;
}
function buildKPIs(){
  const y=lastFull(), y0=YEARS()[0];
  const tot=D.total_por_anio[y], tot0=D.total_por_anio[y0];
  const meta=ejeSum(y,'metabolico'), metaShare=tot?meta/tot*100:null;
  const tasa=D.tasa_cruda_total[y];
  const nc=(D.series.no_codificada?.conteo?.[y])||0, ncShare=tot?nc/tot*100:null;
  const varTot = tot0?((tot/tot0-1)*100):null;
  const box=$('#kpis'); box.innerHTML='';
  const kpis=[
    {lab:`Defunciones registradas (${y})`, val:tot, sub:`${chip(varTot)} vs ${y0}`},
    {lab:`Tasa bruta × 100 000 (${y})`, val:tasa, dec:true, sub:'registradas en SINADEF'},
    {lab:`Muertes cardiometabólicas (${y})`, val:meta, sub:`${fmt1(metaShare)}% del total`},
    {lab:`Sin causa codificada (${y})`, val:nc, sub:`${fmt1(ncShare)}% de los certificados`},
  ];
  kpis.forEach(k=>{
    const d=document.createElement('div'); d.className='kpi';
    d.innerHTML=`<div class="lab">${k.lab}</div><div class="val">—</div><div class="sub">${k.sub}</div>`;
    box.appendChild(d);
    const v=d.querySelector('.val');
    if(k.dec){ v.textContent=fmt1(k.val); } else { animateVal(v,k.val); }
  });
  $('#note_undercount').innerHTML = `<b>Lectura correcta.</b> SINADEF registra una parte creciente de las muertes del país: en los primeros años (2017–2019) el sistema aún se implantaba, por eso el aumento posterior mezcla <b>mortalidad real</b> con <b>mejora de cobertura</b>. Por eso, para comparar años se usan <b>tasas estandarizadas por edad</b> y se muestran los quiebres de serie. Las cifras son un <b>piso</b>, no el total definitivo.`;
}

// ================= selectores =================
function fillSelectors(){
  const yearsDesc=[...YEARS()].reverse();
  const opt=(v,txt)=>`<option value="${v}">${txt||v}${v===PARTIAL()?' (parcial)':''}</option>`;
  $('#yearCauses').innerHTML = yearsDesc.map(y=>opt(y)).join('');
  $('#yearCauses').value=lastFull();
  $('#yearPyr').innerHTML = yearsDesc.map(y=>opt(y)).join('');
  $('#yearPyr').value=lastFull();
  $('#yearMap').innerHTML = yearsDesc.map(y=>opt(y)).join('');
  $('#yearMap').value='2020';
  // causas para el mapa: total + grupos con más peso
  CAUSES = Object.keys(D.series).sort((a,b)=>{
    const sa=Object.values(D.series[a].conteo).reduce((x,y)=>x+y,0);
    const sb=Object.values(D.series[b].conteo).reduce((x,y)=>x+y,0);
    return sb-sa;
  });
  $('#causeMap').innerHTML = `<option value="__total__">Todas las causas</option>` +
    CAUSES.filter(g=>g!=='no_codificada'&&g!=='otras').slice(0,16)
      .map(g=>`<option value="${g}">${D.etiquetas[g].etiqueta}</option>`).join('');
  // mes a mes: años con datos mensuales
  const mYears = Object.keys(D.mensual_sexo).filter(y=>Object.keys(D.mensual_sexo[y]).length).reverse();
  $('#yearMonth').innerHTML = mYears.map(y=>opt(y)).join('');
  $('#yearMonth').value = lastMonthYear().year;
  // pirámide: selector de causa (Todas + grupos con más peso)
  $('#causePyr').innerHTML = `<option value="__total__">Todas las causas</option>` +
    CAUSES.filter(g=>g!=='no_codificada'&&g!=='otras'&&D.causa_edad_sexo[lastFull()]?.[g])
      .slice(0,18).map(g=>`<option value="${g}">${D.etiquetas[g].etiqueta}</option>`).join('');
  // homicidios por edad: año
  $('#yearCrimEdad').innerHTML = yearsDesc.map(y=>opt(y)).join('');
  $('#yearCrimEdad').value = lastFull();
  // serie mensual por causa
  $('#causeMes').innerHTML = (D.monthly_groups||['homicidio']).map(g=>`<option value="${g}">${D.etiquetas[g]?.etiqueta||g}</option>`).join('');
  // cáncer: año + tipo
  $('#yearCancer').innerHTML = yearsDesc.map(y=>opt(y)).join('');
  $('#yearCancer').value = lastFull();
  const tipos=Object.keys(D.cancer_subtipos[lastFull()]||{}).filter(t=>t!=='Otros cánceres');
  $('#typeCancer').innerHTML = tipos.map(t=>`<option value="${t}">${t}</option>`).join('');
  if(tipos.length) $('#typeCancer').value=tipos[0];
}

// ================= charts =================
function chGeneral(){
  const p=palette(), c=ec('ch_general'), ys=YEARS();
  const data = ys.map(y=>D.total_por_anio[y]);
  c.setOption({
    grid:baseGrid(), tooltip:tt({trigger:'axis',
      formatter:a=>{const y=a[0].axisValue; const partial=y===PARTIAL()?' <b style="color:'+p.up+'">(parcial)</b>':'';
        return `<b>${y}</b>${partial}<br>${fmt(a[0].data)} defunciones registradas`;}}),
    xAxis:Object.assign({type:'category',data:ys,boundaryGap:false},axisStyle()),
    yAxis:Object.assign({type:'value'},axisStyle()),
    series:[{
      type:'line', data, smooth:true, symbol:'circle', symbolSize:7,
      lineStyle:{width:3,color:p.brand}, itemStyle:{color:p.brand},
      areaStyle:{color:new echarts.graphic.LinearGradient(0,0,0,1,[
        {offset:0,color:'rgba(179,18,43,.24)'},{offset:1,color:'rgba(179,18,43,0)'}])},
      markArea:{silent:true,itemStyle:{color:'rgba(211,94,0,.08)'},
        label:{show:true,color:p.soft,fontSize:10,position:'insideTop'},
        data:[
          [{xAxis:'2020',name:'COVID-19'},{xAxis:'2021'}],
          [{xAxis:String(D.meta.anio_parcial),name:'parcial',itemStyle:{color:'rgba(138,143,152,.16)'}},{xAxis:String(D.meta.anio_parcial)}]
        ]},
      markPoint:{symbol:'pin',symbolSize:0,data:[]}
    },{
      type:'line', data: ys.map(y=>y===PARTIAL()?D.total_por_anio[y]:null),
      symbol:'circle',symbolSize:9,itemStyle:{color:p.up},lineStyle:{width:0},
      tooltip:{show:false}, z:5
    }]
  }, true);
}

function chTop(){
  const p=palette(), c=ec('ch_top'), y=$('#yearCauses').value;
  const rows=(D.causas_por_anio[y]||[]).filter(r=>r.grupo!=='otras'&&r.grupo!=='no_codificada').slice(0,12).reverse();
  const ejeColor={metabolico:p.cat[0],criminalidad:p.cat[3],accidentes:p.cat[1],cancer:p.cat[6],transmisible:p.cat[2],otras:p.cat[7],mal_definida:p.flat};
  c.setOption({
    grid:{left:8,right:26,top:10,bottom:8,containLabel:true},
    tooltip:tt({trigger:'axis',axisPointer:{type:'shadow'},
      formatter:a=>`${a[0].name}<br><b>${fmt(a[0].data)}</b> defunciones`}),
    xAxis:Object.assign({type:'value'},axisStyle()),
    yAxis:Object.assign({type:'category',data:rows.map(r=>r.etiqueta)},axisStyle(),{axisLabel:{color:palette().soft,fontSize:11,width:150,overflow:'truncate'}}),
    series:[{type:'bar',data:rows.map(r=>({value:r.n,itemStyle:{color:ejeColor[r.eje]||p.cat[7]}})),
      barWidth:'62%',itemStyle:{borderRadius:[0,5,5,0]},
      label:{show:true,position:'right',color:p.soft,fontSize:10,formatter:o=>fmt(o.value)}}]
  }, true);
}

function chBump(){
  const p=palette(), c=ec('ch_bump'), ys=FULL();
  // top groups union across full years by count
  const set=new Set();
  ys.forEach(y=>(D.causas_por_anio[y]||[]).filter(r=>r.grupo!=='otras'&&r.grupo!=='no_codificada').slice(0,8).forEach(r=>set.add(r.grupo)));
  const groups=[...set];
  const rankByYear={};
  ys.forEach(y=>{
    const ordered=(D.causas_por_anio[y]||[]).filter(r=>r.grupo!=='otras'&&r.grupo!=='no_codificada');
    rankByYear[y]={}; ordered.forEach((r,i)=>rankByYear[y][r.grupo]=i+1);
  });
  const series=groups.map((g,i)=>({
    name:D.etiquetas[g].etiqueta, type:'line', smooth:true, symbol:'circle',symbolSize:8,
    lineStyle:{width:2.5,color:p.cat[i%8]}, itemStyle:{color:p.cat[i%8]},
    data:ys.map(y=>rankByYear[y][g]||null),
    endLabel:{show:true,formatter:o=>o.seriesName,color:p.soft,fontSize:10},
    emphasis:{focus:'series'}
  }));
  c.setOption({
    grid:{left:8,right:120,top:10,bottom:8,containLabel:true},
    tooltip:tt({trigger:'item',formatter:o=>`${o.seriesName}<br>${o.name}: puesto ${o.data}`}),
    xAxis:Object.assign({type:'category',data:ys,boundaryGap:false},axisStyle()),
    yAxis:Object.assign({type:'value',inverse:true,min:1,max:Math.max(...groups.map(g=>Math.max(...ys.map(y=>rankByYear[y][g]||0)))),
      interval:1,axisLabel:{formatter:v=>'#'+v,color:p.soft,fontSize:11}},axisStyle()),
    series
  }, true);
}

const META_GROUPS=['isquemicas','cerebrovascular','diabetes','hipertensivas','renal_cronica'];
let metaMetric='tasa_estandarizada';
function chMeta(){
  const p=palette(), c=ec('ch_meta'), ys=YEARS();
  const unidad = metaMetric==='conteo'?'defunciones':'× 100 000';
  const series=META_GROUPS.map((g,i)=>({
    name:D.etiquetas[g].etiqueta, type:'line', smooth:true, symbol:'circle',symbolSize:6,
    lineStyle:{width:2.5,color:p.cat[i%8]},itemStyle:{color:p.cat[i%8]},
    connectNulls:true,
    data:ys.map(y=>D.series[g][metaMetric][y])
  }));
  if(series[0]) series[0].markArea=partialBand();
  c.setOption({
    grid:gridL(), legend:legTop(),
    tooltip:tt({trigger:'axis',valueFormatter:v=>v==null?'—':fmt1(v)}),
    xAxis:Object.assign({type:'category',data:ys,boundaryGap:false},axisStyle()),
    yAxis:Object.assign({type:'value'},axisStyle()),
    series
  }, true);
}

function chCrim(){
  const p=palette(), c=ec('ch_crim'), ys=YEARS();
  const mk=(g,i)=>({name:D.etiquetas[g].etiqueta,type:'line',smooth:true,symbol:'circle',symbolSize:6,
    lineStyle:{width:2.5,color:i===0?p.cat[3]:p.cat[4]},itemStyle:{color:i===0?p.cat[3]:p.cat[4]},
    data:ys.map(y=>D.series[g]?.conteo?.[y]),connectNulls:true});
  const s=[mk('homicidio',0),mk('suicidio',1)]; s[0].markArea=partialBand();
  c.setOption({
    grid:gridL(), legend:legTop(),
    tooltip:tt({trigger:'axis'}),
    xAxis:Object.assign({type:'category',data:ys,boundaryGap:false},axisStyle()),
    yAxis:Object.assign({type:'value'},axisStyle()),
    series:s
  }, true);
}
function chCrimSexo(){
  const p=palette(), c=ec('ch_crimSexo'), y=lastFull();
  const g=['homicidio','suicidio'];
  const val=(gr,s)=>D.por_sexo[gr]?.[y]?.[s]||0;
  c.setOption({
    grid:gridL(), legend:legTop(),
    tooltip:tt({trigger:'axis',axisPointer:{type:'shadow'}}),
    xAxis:Object.assign({type:'category',data:g.map(x=>D.etiquetas[x].etiqueta)},axisStyle()),
    yAxis:Object.assign({type:'value'},axisStyle()),
    series:[
      {name:'Hombres',type:'bar',stack:'s',data:g.map(x=>val(x,'M')),itemStyle:{color:p.cat[0]},barWidth:'45%'},
      {name:'Mujeres',type:'bar',stack:'s',data:g.map(x=>val(x,'F')),itemStyle:{color:p.cat[4]}}
    ]
  }, true);
}

const ACC_GROUPS=['acc_transito','acc_caidas','acc_ahogamiento','acc_intoxicacion','acc_otros','intencion_indet'];
function chAcc(){
  const p=palette(), c=ec('ch_acc'), ys=YEARS();
  const series=ACC_GROUPS.filter(g=>D.series[g]).map((g,i)=>({
    name:D.etiquetas[g].etiqueta,type:'bar',stack:'acc',
    itemStyle:{color:g==='acc_transito'?p.cat[3]:p.cat[i%8]},
    emphasis:{focus:'series'},
    data:ys.map(y=>D.series[g].conteo[y])
  }));
  if(series[0]) series[0].markArea=partialBand();
  c.setOption({
    grid:gridL(), legend:legTop(),
    tooltip:tt({trigger:'axis',axisPointer:{type:'shadow'}}),
    xAxis:Object.assign({type:'category',data:ys},axisStyle()),
    yAxis:Object.assign({type:'value'},axisStyle()),
    series
  }, true);
}

function chPyr(){
  const p=palette(), c=ec('ch_pyr'), y=$('#yearPyr').value, cause=$('#causePyr').value;
  const ages=D.grupos_edad;
  let getM, getF, titulo;
  if(cause==='__total__' || !D.causa_edad_sexo[y]?.[cause]){
    getM=a=>D.piramide[y]?.M?.[a]||0; getF=a=>D.piramide[y]?.F?.[a]||0; titulo='Todas las causas';
  } else {
    const ces=D.causa_edad_sexo[y][cause];
    getM=a=>ces.M?.[a]||0; getF=a=>ces.F?.[a]||0; titulo=D.etiquetas[cause].etiqueta;
  }
  const M=ages.map(a=>-getM(a)), F=ages.map(a=>getF(a));
  const maxv=Math.max(1,...M.map(v=>-v),...F);
  c.setOption({
    grid:{left:8,right:20,top:42,bottom:16,containLabel:true},
    legend:legTop(),
    tooltip:tt({trigger:'axis',axisPointer:{type:'shadow'},
      formatter:a=>{const i=a[0].dataIndex; return `Edad ${ages[i]}<br>Hombres: ${fmt(Math.abs(M[i]))}<br>Mujeres: ${fmt(F[i])}`;}}),
    xAxis:Object.assign({type:'value',max:maxv,min:-maxv,axisLabel:{formatter:v=>fmt(Math.abs(v)),color:p.soft,fontSize:10}},axisStyle()),
    yAxis:Object.assign({type:'category',data:ages,axisLabel:{color:p.soft,fontSize:10}},axisStyle()),
    series:[
      {name:'Hombres',type:'bar',stack:'p',data:M,itemStyle:{color:p.cat[0]}},
      {name:'Mujeres',type:'bar',stack:'p',data:F,itemStyle:{color:p.cat[4]}}
    ]
  }, true);
  $('#src_pyr').textContent=`${titulo} · edad y sexo (${y}) · SINADEF`;
  const th=M.reduce((a,b)=>a-b,0), tf=F.reduce((a,b)=>a+b,0), tot=th+tf;
  let modal=ages[0], mx=-1; ages.forEach((a,i)=>{const s=(-M[i])+F[i]; if(s>mx){mx=s;modal=a;}});
  const ratio=tf?Math.round(th/tf*100):0, pctH=tot?th/tot*100:0;
  const mas = pctH>=50?'hombres':'mujeres';
  $('#pyrNote').innerHTML=`
    <div class="lab">${titulo} · ${y}${y===PARTIAL()?' (parcial)':''}</div>
    <div class="big">${fmt1(Math.max(pctH,100-pctH))}%</div>
    <p>de estas muertes fueron <b>${mas}</b> (por cada 100 mujeres, <b>${ratio} hombres</b>).</p>
    <div class="lab" style="margin-top:12px">Edad con más defunciones</div>
    <p><b>${modal}</b> años concentra la mayor cantidad${cause==='__total__'?'':' por esta causa'}. La mortalidad se dispara con la edad.</p>`;
}

function chMap(){
  const p=palette(), c=ec('ch_map');
  if(!GEO){ $('#ch_map').innerHTML='<p class="hint" style="padding:20px">Mapa no disponible (no se cargó el GeoJSON).</p>'; return; }
  if(!echarts.getMap('peru')) echarts.registerMap('peru', GEO, {});
  const y=$('#yearMap').value, cause=$('#causeMap').value;
  let dataMap={}, unidad='', title='';
  if(cause==='__total__' || !D.etiquetas[cause]){
    const rates=D.tasa_departamento[y];
    if(rates && Object.keys(rates).length){ dataMap=rates; unidad='× 100 000 hab.'; title='Tasa bruta de mortalidad'; }
    else { dataMap=D.por_departamento[y]||{}; unidad='defunciones'; title='Defunciones registradas'; }
  } else {
    const dg=D.departamento_grupo[y]||{};
    Object.keys(dg).forEach(dep=>{ if(dg[dep][cause]!=null) dataMap[dep]=dg[dep][cause]; });
    unidad='defunciones'; title=D.etiquetas[cause].etiqueta;
  }
  const vals=Object.entries(dataMap).filter(([k])=>k!=='EXTRANJERO/NO DETERMINADO'&&k!=='NO DETERMINADO');
  const data=vals.map(([name,value])=>({name,value}));
  const nums=vals.map(v=>v[1]);
  c.setOption({
    tooltip:tt({trigger:'item',formatter:o=>o.value==null||isNaN(o.value)?`${o.name}<br>sin dato`:`<b>${o.name}</b><br>${fmt1(o.value)} ${unidad}`}),
    visualMap:{left:10,bottom:14,min:Math.min(...nums,0),max:Math.max(...nums,1),
      text:['alto','bajo'],calculable:true,inRange:{color:['#f8e9d8','#e69f00','#b3122b']},
      textStyle:{color:p.soft,fontSize:11}},
    series:[{name:title,type:'map',map:'peru',roam:false,
      nameProperty:'NOMBDEP',
      itemStyle:{borderColor:p.card,borderWidth:.8,areaColor:p.line},
      emphasis:{itemStyle:{areaColor:p.brand},label:{show:false}},
      select:{itemStyle:{areaColor:p.brand}},
      label:{show:false}, data}]
  }, true);
  $('#src_map').textContent = `${title} (${y}, ${unidad}) · SINADEF · INEI · GeoJSON juaneladio`;
  c.off('click'); c.on('click', params=>{ if(params&&params.name){ mapSelDep=params.name; renderMapPanel(params.name); }});
  if(mapSelDep) renderMapPanel(mapSelDep);
}

function chCancer(){
  const p=palette(), c=ec('ch_cancer'), y=$('#yearCancer')?.value||lastFull();
  if($('#src_cancer')) $('#src_cancer').textContent=`SINADEF C00–C97 · ${y}`;
  const subs=Object.entries(D.cancer_subtipos[y]||{}).filter(([k])=>k!=='Otros cánceres');
  c.setOption({
    tooltip:tt({trigger:'item',formatter:o=>`${o.name}<br><b>${fmt(o.value)}</b> defunciones (${o.percent}%)`}),
    series:[{type:'treemap',roam:false,nodeClick:false,breadcrumb:{show:false},
      data:subs.map(([name,value],i)=>({name,value,itemStyle:{color:p.cat[i%8]}})),
      label:{show:true,color:'#fff',fontSize:12,formatter:o=>`${o.name}\n${fmt(o.value)}`},
      itemStyle:{borderColor:p.card,borderWidth:2,gapWidth:2},
      levels:[{itemStyle:{borderWidth:0}}]
    }]
  }, true);
}
function chVih(){
  const p=palette(), c=ec('ch_vih'), ys=YEARS();
  const mk=(g,i,color)=>({name:D.etiquetas[g].etiqueta,type:'line',smooth:true,symbol:'circle',symbolSize:6,
    lineStyle:{width:2.5,color},itemStyle:{color},
    data:ys.map(y=>D.series[g]?.conteo?.[y]),connectNulls:true});
  const s=[mk('vih_sida',0,p.cat[4]), mk('covid19',1,p.cat[3])]; s[0].markArea=partialBand();
  c.setOption({
    grid:gridL(), legend:legTop(),
    tooltip:tt({trigger:'axis'}),
    xAxis:Object.assign({type:'category',data:ys,boundaryGap:false},axisStyle()),
    yAxis:Object.assign({type:'value'},axisStyle()),
    series:s
  }, true);
}

function chMonth(){
  const p=palette(), c=ec('ch_month'), y=$('#yearMonth').value;
  const md=D.mensual_sexo[y]||{};
  const months=Object.keys(md).sort();
  const cats=months.map(m=>MESES_C[+m]);
  const H=months.map(m=>md[m].M), F=months.map(m=>md[m].F);
  c.setOption({
    grid:gridL(), legend:legTop(),
    tooltip:tt({trigger:'axis',
      formatter:a=>{const i=a[0].dataIndex,h=H[i],f=F[i];
        return `${MESES[+months[i]]} ${y}<br>Hombres: <b>${fmt(h)}</b><br>Mujeres: <b>${fmt(f)}</b><br>Total: ${fmt(h+f)}`;}}),
    xAxis:Object.assign({type:'category',data:cats,boundaryGap:false},axisStyle()),
    yAxis:Object.assign({type:'value'},axisStyle()),
    series:[
      {name:'Hombres',type:'line',smooth:true,symbol:'circle',symbolSize:6,data:H,
        lineStyle:{width:3,color:p.cat[0]},itemStyle:{color:p.cat[0]},
        areaStyle:{color:'rgba(0,114,178,.10)'}},
      {name:'Mujeres',type:'line',smooth:true,symbol:'circle',symbolSize:6,data:F,
        lineStyle:{width:3,color:p.cat[4]},itemStyle:{color:p.cat[4]},
        areaStyle:{color:'rgba(213,94,0,.08)'}},
    ]
  }, true);
  const th=H.reduce((a,b)=>a+b,0), tf=F.reduce((a,b)=>a+b,0), tot=th+tf;
  const ratio=tf?Math.round(th/tf*100):0, pctH=tot?th/tot*100:0;
  const parcial = y===PARTIAL();
  $('#monthNote').innerHTML=`
    <div class="lab">En ${y}${parcial?' · hasta '+MESES[lastMonthYear().month]:''}</div>
    <div class="big">${fmt1(pctH)}%</div>
    <p>de las defunciones registradas fueron <b>hombres</b>.</p>
    <div class="lab" style="margin-top:12px">Sobre-mortalidad masculina</div>
    <p>Por cada <b>100 mujeres</b> fallecidas se registraron <b>${ratio} hombres</b>. La brecha se mantiene todos los meses del año.</p>`;
}

function chHero(){
  const p=palette(), c=ec('ch_hero'), ys=YEARS();
  const data=ys.map(y=>D.total_por_anio[y]);
  c.setOption({
    grid:{left:6,right:12,top:14,bottom:6,containLabel:true},
    tooltip:tt({trigger:'axis',formatter:a=>`<b>${a[0].axisValue}</b>${a[0].axisValue===String(D.meta.anio_parcial)?' (parcial)':''}<br>${fmt(a[0].data)} defunciones`}),
    xAxis:Object.assign({type:'category',data:ys,boundaryGap:false,axisLabel:{color:p.soft,fontSize:10,interval:1}},axisStyle()),
    yAxis:Object.assign({type:'value',show:false},axisStyle(),{splitLine:{show:false}}),
    series:[{type:'line',data,smooth:true,symbol:'none',lineStyle:{width:2.5,color:p.brand},
      areaStyle:{color:new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:'rgba(179,18,43,.30)'},{offset:1,color:'rgba(179,18,43,0)'}])},
      markArea:{silent:true,itemStyle:{color:'rgba(211,94,0,.08)'},
        data:[[{xAxis:'2020'},{xAxis:'2021'}],
              [{xAxis:String(D.meta.anio_parcial),itemStyle:{color:'rgba(138,143,152,.16)'}},{xAxis:String(D.meta.anio_parcial)}]]}}]
  }, true);
  $('#heroCap').textContent=`Defunciones registradas por año · ${YEARS()[0]}–${YEARS()[YEARS().length-1]} · SINADEF`;
}

function chCrimEdad(){
  const p=palette(), c=ec('ch_crimEdad'), y=$('#yearCrimEdad').value, ages=D.grupos_edad;
  const ces=D.causa_edad_sexo[y]?.homicidio||{M:{},F:{}};
  const H=ages.map(a=>ces.M?.[a]||0), F=ages.map(a=>ces.F?.[a]||0);
  c.setOption({
    grid:gridL(), legend:legTop(),
    tooltip:tt({trigger:'axis',axisPointer:{type:'shadow'},
      formatter:a=>{const i=a[0].dataIndex;return `Edad ${ages[i]}<br>Hombres: <b>${fmt(H[i])}</b><br>Mujeres: <b>${fmt(F[i])}</b>`;}}),
    xAxis:Object.assign({type:'category',data:ages,axisLabel:{color:p.soft,fontSize:10}},axisStyle()),
    yAxis:Object.assign({type:'value'},axisStyle()),
    series:[
      {name:'Hombres',type:'bar',stack:'h',data:H,itemStyle:{color:p.cat[3]},barWidth:'62%'},
      {name:'Mujeres',type:'bar',stack:'h',data:F,itemStyle:{color:p.cat[4]}},
    ]
  }, true);
}

function ramp(i,n){ const t=n>1?i/(n-1):1; return `hsl(352,64%,${Math.round(80-50*t)}%)`; }

let causeOfi='homicidios';
function chOficial(){
  const p=palette(), c=ec('ch_oficial'), fo=D.fuentes_oficiales||{};
  const blk=fo[causeOfi]||{}, of=blk.serie||{};
  const sinGroup = causeOfi==='homicidios'?'homicidio':'acc_transito';
  const yrs=Object.keys(of).sort();
  const oficial=yrs.map(y=>of[y]);
  const sinadef=yrs.map(y=>D.series[sinGroup]?.conteo?.[y]??0);
  c.setOption({
    grid:gridL(), legend:legTop(), tooltip:tt({trigger:'axis',axisPointer:{type:'shadow'}}),
    xAxis:Object.assign({type:'category',data:yrs},axisStyle()),
    yAxis:Object.assign({type:'value'},axisStyle()),
    series:[
      {name:'Cifra oficial',type:'bar',data:oficial,itemStyle:{color:p.cat[3],borderRadius:[4,4,0,0]},barMaxWidth:26},
      {name:'Registrado en SINADEF',type:'bar',data:sinadef,itemStyle:{color:p.cat[7],borderRadius:[4,4,0,0]},barMaxWidth:26},
    ]
  }, true);
  const lf=lastFull(); const oy=(of[lf]!=null)?lf:yrs[yrs.length-1];
  const capt=of[oy]?(D.series[sinGroup].conteo[oy]/of[oy]*100):null;
  const nomOf = causeOfi==='homicidios'?'homicidios (víctimas, CEIC-INEI)':'fallecidos en tránsito (MININTER/PNP)';
  $('#ofiNote').innerHTML=`⚠️ En ${oy}, la cifra oficial de <b>${nomOf}</b> fue <b>${fmt(of[oy])}</b>, pero SINADEF registró solo <b>${fmt(D.series[sinGroup].conteo[oy])}</b> con ese código — apenas <b>${fmt1(capt)}%</b>. Por eso, para ${causeOfi} la magnitud real viene de estas fuentes, no del certificado.`;
  $('#src_oficial').textContent=`${(blk.fuente||'').slice(0,70)} · vs SINADEF`;
}
let modeMes='anios';
function chHomMes(){
  const p=palette(), c=ec('ch_hommes'), g=$('#causeMes').value, ys=YEARS();
  const pad=m=>String(m).padStart(2,'0');
  if(modeMes==='anios'){
    const series=ys.map((y,i)=>{
      const has=D.mensual_sexo[y]||{}, mg=D.mensual_grupo[y]||{};
      const data=[...Array(12)].map((_,m)=>{const k=pad(m+1); return (k in has)?((mg[k]||{})[g]||0):null;});
      const partial=y===PARTIAL(), col=ramp(i,ys.length), recent=(y===lastFull());
      return {name:y,type:'line',smooth:true,symbol:partial||recent?'circle':'none',symbolSize:5,
        lineStyle:{width:partial?2.5:(recent?3.2:1.6),color:col,type:partial?'dashed':'solid'},
        itemStyle:{color:col},emphasis:{focus:'series'},connectNulls:false,data};
    });
    c.setOption({
      grid:gridL(), legend:legTop(), tooltip:tt({trigger:'axis',order:'valueDesc'}),
      xAxis:Object.assign({type:'category',data:MESES_C.slice(1),boundaryGap:false},axisStyle()),
      yAxis:Object.assign({type:'value'},axisStyle()),
      series
    }, true);
  } else {
    const cats=[], data=[];
    ys.forEach(y=>{const has=D.mensual_sexo[y]||{}, mg=D.mensual_grupo[y]||{};
      Object.keys(has).sort().forEach(k=>{cats.push(`${MESES_C[+k]} ${y.slice(2)}`); data.push((mg[k]||{})[g]||0);});});
    c.setOption({
      grid:{left:8,right:16,top:16,bottom:14,containLabel:true}, tooltip:tt({trigger:'axis'}),
      xAxis:Object.assign({type:'category',data:cats,axisLabel:{interval:11,color:p.soft,fontSize:10}},axisStyle()),
      yAxis:Object.assign({type:'value'},axisStyle()),
      series:[{type:'line',smooth:true,symbol:'none',data,lineStyle:{width:2,color:p.cat[3]},itemStyle:{color:p.cat[3]},
        areaStyle:{color:'rgba(213,94,0,.10)'},
        markLine:{silent:true,symbol:'none',lineStyle:{color:p.line},data:ys.slice(1).map(y=>({xAxis:`${MESES_C[1]} ${y.slice(2)}`}))}}]
    }, true);
  }
}

function chCancerTrend(){
  const p=palette(), c=ec('ch_cancerTrend'), tipo=$('#typeCancer').value, ys=YEARS();
  if($('#cancerTrendTitle')) $('#cancerTrendTitle').textContent=tipo;
  const H=ys.map(y=>D.cancer_subtipos_sexo[y]?.[tipo]?.M||0);
  const F=ys.map(y=>D.cancer_subtipos_sexo[y]?.[tipo]?.F||0);
  const s=[
    {name:'Hombres',type:'line',smooth:true,symbol:'circle',symbolSize:6,data:H,lineStyle:{width:2.5,color:p.cat[0]},itemStyle:{color:p.cat[0]}},
    {name:'Mujeres',type:'line',smooth:true,symbol:'circle',symbolSize:6,data:F,lineStyle:{width:2.5,color:p.cat[4]},itemStyle:{color:p.cat[4]}},
  ]; s[0].markArea=partialBand();
  c.setOption({
    grid:gridL(), legend:legTop(), tooltip:tt({trigger:'axis'}),
    xAxis:Object.assign({type:'category',data:ys,boundaryGap:false},axisStyle()),
    yAxis:Object.assign({type:'value'},axisStyle()),
    series:s
  }, true);
}

let mapSelDep=null;
function renderMapPanel(dep){
  const y=$('#yearMap').value;
  const dg=(D.departamento_grupo[y]||{})[dep];
  const panel=$('#mapPanel');
  if(!panel) return;
  if(!dg){ panel.innerHTML=`<p class="hint">Sin desglose por causa para ${dep} en ${y}.</p>`; return; }
  const rows=Object.entries(dg).filter(([g])=>g!=='no_codificada'&&g!=='otras')
    .map(([g,n])=>({et:(D.etiquetas[g]||{}).etiqueta||g,n})).sort((a,b)=>b.n-a.n).slice(0,10);
  const tot=D.por_departamento[y]?.[dep]||rows.reduce((s,r)=>s+r.n,0);
  const mx=rows.length?rows[0].n:1;
  panel.innerHTML=`<div class="mapcauses">
    <h4>${dep}</h4>
    <p class="sub">${fmt(tot)} defunciones registradas en ${y} · principales causas</p>
    ${rows.map(r=>`<div class="row"><span class="nm">${r.et}</span><span class="bar"><i style="width:${Math.max(4,Math.round(r.n/mx*100))}%"></i></span><span class="vn">${fmt(r.n)}</span></div>`).join('')}
  </div>`;
}

// ================= semáforo =================
function buildSemaforo(){
  const box=$('#semaforoMeta'); box.innerHTML='';
  const label={aumento:'En aumento',descenso:'En descenso',sin_tendencia:'Sin tendencia definida',sin_datos:'Sin datos'};
  const cls={aumento:'up',descenso:'down',sin_tendencia:'flat',sin_datos:'flat'};
  const arr={aumento:'▲',descenso:'▼',sin_tendencia:'▬',sin_datos:'▬'};
  META_GROUPS.forEach(g=>{
    const t=D.tendencias[g]; const s=t.semaforo;
    const d=document.createElement('div'); d.className='sm '+cls[s];
    const pct = t.pendiente_pct_anual!=null ? `${t.pendiente_pct_anual>0?'+':''}${fmt1(t.pendiente_pct_anual)}%/año` : '';
    d.innerHTML=`<div class="t">${D.etiquetas[g].etiqueta}</div>
      <div class="d">${t.significativa?`IC 95%: ${t.ic95[0]}% a ${t.ic95[1]}%`:'cambio no significativo'}</div>
      <span class="badge">${arr[s]} ${label[s]} ${t.significativa?'· '+pct:''}</span>`;
    box.appendChild(d);
  });
}

// ================= metodología =================
function buildMethods(){
  const ul=$('#methodsList'); const items=[
    ...(D.meta.notas_calidad||[]),
    'Tasa estandarizada por edad: método directo con la Población Estándar Mundial (OMS) y denominadores del INEI reescalados por año.',
    'Tendencia: regresión log-lineal de la tasa estandarizada sobre los años completos (2017–2023). El semáforo solo marca dirección cuando el IC 95% de la pendiente excluye el cero.',
    'Los años COVID-19 (2020–2022) se muestran pero se leen con cautela por el exceso de mortalidad y las disrupciones de registro.',
    `Registros procesados: ${fmt(D.meta.registros_leidos)} certificados de defunción.`,
    'El año en curso se muestra como «parcial» y no se compara como año completo.',
    'La codificación CIE-10 de la causa va con rezago: en los años más recientes hay una mayor proporción de «causa no codificada», por lo que el detalle por causa de 2025–2026 es provisional y se irá completando.',
    'Para la carga REAL estimada (corrigiendo subregistro y mala clasificación) la referencia mundial es el Global Burden of Disease (GBD/IHME); aquí se cita como contraste, no se republica (sus datos por causa no son redistribuibles).',
  ];
  ul.innerHTML=items.map(t=>`<li>${t}</li>`).join('');
}

// ================= controles =================
function wireControls(){
  $('#yearCauses').onchange=chTop;
  $('#yearPyr').onchange=chPyr;
  $('#causePyr').onchange=chPyr;
  $('#yearMonth').onchange=chMonth;
  $('#yearMap').onchange=chMap;
  $('#causeMap').onchange=chMap;
  $('#yearCrimEdad').onchange=chCrimEdad;
  $('#yearCancer').onchange=chCancer;
  $('#typeCancer').onchange=chCancerTrend;
  $('#causeMes').onchange=chHomMes;
  $$('#modeMes button').forEach(b=>b.onclick=()=>{
    $$('#modeMes button').forEach(x=>x.classList.remove('on'));
    b.classList.add('on'); modeMes=b.dataset.mode; chHomMes();
  });
  $$('#causeOfi button').forEach(b=>b.onclick=()=>{
    $$('#causeOfi button').forEach(x=>x.classList.remove('on'));
    b.classList.add('on'); causeOfi=b.dataset.c; chOficial();
  });
  $$('#metricMeta button').forEach(b=>b.onclick=()=>{
    $$('#metricMeta button').forEach(x=>x.classList.remove('on'));
    b.classList.add('on'); metaMetric=b.dataset.m; chMeta();
  });
}

// ================= CSV =================
function download(name, rows){
  const csv=rows.map(r=>r.map(c=>{const s=(c==null?'':String(c)); return /[",;\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}).join(',')).join('\n');
  const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name;
  document.body.appendChild(a); a.click(); a.remove();
}
function wireCSV(){
  const ys=YEARS();
  const gens={
    general:()=>[['anio','defunciones_registradas'],...ys.map(y=>[y,D.total_por_anio[y]])],
    top:()=>{const y=$('#yearCauses').value;return [['anio','causa','eje','defunciones'],...(D.causas_por_anio[y]||[]).map(r=>[y,r.etiqueta,r.eje,r.n])];},
    bump:()=>{const yy=FULL();const rows=[['anio','puesto','causa','defunciones']];yy.forEach(y=>(D.causas_por_anio[y]||[]).filter(r=>r.grupo!=='otras').forEach((r,i)=>rows.push([y,i+1,r.etiqueta,r.n])));return rows;},
    meta:()=>{const rows=[['anio','causa','metrica','valor']];META_GROUPS.forEach(g=>ys.forEach(y=>rows.push([y,D.etiquetas[g].etiqueta,metaMetric,D.series[g][metaMetric][y]])));return rows;},
    crim:()=>{const rows=[['anio','causa','defunciones']];['homicidio','suicidio'].forEach(g=>ys.forEach(y=>rows.push([y,D.etiquetas[g].etiqueta,D.series[g].conteo[y]])));return rows;},
    crimSexo:()=>{const y=lastFull();const rows=[['causa','sexo','defunciones']];['homicidio','suicidio'].forEach(g=>['M','F'].forEach(s=>rows.push([D.etiquetas[g].etiqueta,s,D.por_sexo[g]?.[y]?.[s]||0])));return rows;},
    acc:()=>{const rows=[['anio','tipo','defunciones']];ACC_GROUPS.filter(g=>D.series[g]).forEach(g=>ys.forEach(y=>rows.push([y,D.etiquetas[g].etiqueta,D.series[g].conteo[y]])));return rows;},
    month:()=>{const y=$('#yearMonth').value;const rows=[['anio','mes','hombres','mujeres','total']];Object.keys(D.mensual_sexo[y]||{}).sort().forEach(m=>{const r=D.mensual_sexo[y][m];rows.push([y,m,r.M,r.F,r.T]);});return rows;},
    pyr:()=>{const y=$('#yearPyr').value,cause=$('#causePyr').value;const rows=[['anio','causa','grupo_edad','sexo','defunciones']];const src=(cause!=='__total__'&&D.causa_edad_sexo[y]?.[cause])?D.causa_edad_sexo[y][cause]:D.piramide[y];const et=cause==='__total__'?'Todas':D.etiquetas[cause]?.etiqueta||cause;D.grupos_edad.forEach(a=>['M','F'].forEach(s=>rows.push([y,et,a,s,src?.[s]?.[a]||0])));return rows;},
    map:()=>{const y=$('#yearMap').value;const rows=[['anio','departamento','tasa_x100k','defunciones']];Object.keys(D.por_departamento[y]||{}).forEach(dep=>rows.push([y,dep,(D.tasa_departamento[y]||{})[dep]??'',D.por_departamento[y][dep]]));return rows;},
    cancer:()=>{const y=$('#yearCancer').value;return [['anio','tipo_cancer','defunciones'],...Object.entries(D.cancer_subtipos[y]||{}).map(([k,v])=>[y,k,v])];},
    cancerTrend:()=>{const t=$('#typeCancer').value;const rows=[['anio','tipo','sexo','defunciones']];YEARS().forEach(y=>['M','F'].forEach(s=>rows.push([y,t,s,D.cancer_subtipos_sexo[y]?.[t]?.[s]||0])));return rows;},
    crimEdad:()=>{const y=$('#yearCrimEdad').value;const ces=D.causa_edad_sexo[y]?.homicidio||{M:{},F:{}};const rows=[['anio','grupo_edad','sexo','homicidios']];D.grupos_edad.forEach(a=>['M','F'].forEach(s=>rows.push([y,a,s,ces[s]?.[a]||0])));return rows;},
    hommes:()=>{const g=$('#causeMes').value;const rows=[['anio','mes','causa',D.etiquetas[g]?.etiqueta||g]];YEARS().forEach(y=>Object.keys(D.mensual_sexo[y]||{}).sort().forEach(m=>rows.push([y,m,g,(D.mensual_grupo[y]?.[m]||{})[g]||0])));return rows;},
    oficial:()=>{const fo=D.fuentes_oficiales||{};const of=fo[causeOfi]?.serie||{};const sg=causeOfi==='homicidios'?'homicidio':'acc_transito';const rows=[['anio','cifra_oficial','registrado_sinadef']];Object.keys(of).sort().forEach(y=>rows.push([y,of[y],D.series[sg]?.conteo?.[y]??'']));return rows;},
    vih:()=>{const rows=[['anio','causa','defunciones']];['vih_sida','covid19'].forEach(g=>ys.forEach(y=>rows.push([y,D.etiquetas[g].etiqueta,D.series[g]?.conteo?.[y]||0])));return rows;},
  };
  $$('[data-csv]').forEach(b=>b.onclick=()=>{const k=b.dataset.csv; if(gens[k]) download(`mortalidad-peru_${k}.csv`, gens[k]());});
}

// ================= chat (stub, gateway pendiente) =================
const CHAT_SYS = "Eres el asistente de «¿De qué morimos en el Perú?», un observatorio de mortalidad basado en datos oficiales de SINADEF (MINSA, 2017–2026) e INEI. Responde en español, breve y claro. Las cifras son defunciones REGISTRADAS (subestiman la mortalidad real por subregistro; las causas externas como homicidios están muy sub-registradas). No inventes cifras.";
function chatFacts(){
  const y=lastFull(); const D_=D;
  const top=(D_.causas_por_anio[y]||[]).filter(c=>c.grupo!=='no_codificada'&&c.grupo!=='otras').slice(0,5);
  const cancer=Object.entries(D_.cancer_subtipos[y]||{}).sort((a,b)=>b[1]-a[1])[0];
  return {y, top, cancer,
    val:g=>D_.series[g]?.conteo?.[y], tasa:g=>D_.series[g]?.tasa_estandarizada?.[y],
    et:g=>D_.etiquetas[g]?.etiqueta||g};
}
function localAnswer(q){
  const t=norm(q), F=chatFacts(), y=F.y;
  const has=(...w)=>w.some(x=>t.includes(x));
  if(has('daly','discapacidad','años de vida','anos de vida','avad'))
    return `El DALY (año de vida ajustado por discapacidad) es la métrica central del GBD/IHME: suma los años de vida perdidos por muerte prematura más los años vividos con discapacidad. Capta la carga de enfermar, no solo de morir. Este observatorio se centra en mortalidad; para DALYs del Perú, mira GBD Compare de IHME (enlace en Metodología).`;
  if(has('gbd','ihme','carga real','burden','verdadero','cifra real','realidad'))
    return `Este observatorio muestra muertes REGISTRADAS (SINADEF) y registros oficiales (CEIC-INEI, MININTER). Para la carga REAL estimada —corrigiendo subregistro— la referencia mundial es el Global Burden of Disease (GBD) del IHME (U. de Washington), que modela 288 causas con intervalos de incertidumbre y usa el DALY. Lo citamos como contraste en Metodología (sus datos por causa no son redistribuibles); puedes explorarlo en GBD Compare.`;
  if(has('homicidio','asesinato','violencia','crimen','matan')){
    const of=D.fuentes_oficiales?.homicidios?.serie||{}; const oy=of[y]!=null?y:Object.keys(of).sort().at(-1);
    const ofi=oy?`La cifra OFICIAL (CEIC-INEI) fue ${fmt(of[oy])} homicidios en ${oy}: SINADEF solo capta ~${fmt1((F.val('homicidio')||0)/of[oy]*100)}%. `:'';
    return `En ${y} SINADEF registró ${fmt(F.val('homicidio'))} muertes con código de homicidio. ${ofi}Las causas externas están MUY sub-registradas en los certificados; usa la sección de Criminalidad para ver el contraste.`;
  }
  if(has('cancer','tumor')) return `El cáncer es de las primeras causas: en ${y} se registraron ${fmt(F.val('cancer'))} muertes por tumores. El tipo más frecuente es ${F.cancer?F.cancer[0]+' ('+fmt(F.cancer[1])+')':'—'}. El Perú tiene una carga alta de cáncer de estómago.`;
  if(has('diabetes')) return `La diabetes causó ${fmt(F.val('diabetes'))} defunciones registradas en ${y} (tasa estandarizada ${fmt1(F.tasa('diabetes'))} por 100 000). Es uno de los ejes metabólicos de prevención.`;
  if(has('corazon','cardiaco','infarto','isquemic','cardiovascular')) return `Las enfermedades isquémicas del corazón registraron ${fmt(F.val('isquemicas'))} muertes en ${y}; sumadas a hipertensivas y cerebrovasculares forman el mayor bloque cardiovascular.`;
  if(has('suicidio')) return `En ${y} se registraron ${fmt(F.val('suicidio'))} suicidios (lesiones autoinfligidas) en SINADEF. También hay subregistro en causas externas.`;
  if(has('transito','accidente','choque','carretera')) return `Los accidentes de tránsito registrados en SINADEF fueron ${fmt(F.val('acc_transito'))} en ${y}. El dato fino lo tiene el MTC/PNP y es mayor.`;
  if(has('covid')) return `El COVID-19 marcó el pico de mortalidad en 2020–2021. Puedes ver la serie en la sección «VIH/sida y COVID-19».`;
  if(has('vih','sida')) return `Las muertes por VIH/sida registradas fueron ${fmt(F.val('vih_sida'))} en ${y}.`;
  if(has('hombre','mujer','sexo','genero')){ const ts=D.total_por_anio_sexo[y]||{}; const m=ts.M||0,f=ts.F||0,tt=m+f; return `En ${y}, ${fmt1(tt?m/tt*100:0)}% de las defunciones registradas fueron hombres y ${fmt1(tt?f/tt*100:0)}% mujeres. Los hombres mueren más en casi todas las edades.`; }
  if(has('cuanto','cuantos','total','defunciones','mueren','muertes','fallecid')){
    const p=String(D.meta.anio_parcial); return `En ${y} se registraron ${fmt(D.total_por_anio[y])} defunciones en SINADEF (tasa bruta ${fmt1(D.tasa_cruda_total[y])} por 100 000). ${p} va parcial con ${fmt(D.total_por_anio[p])} hasta ahora.`;
  }
  if(has('edad','viejo','joven','años')) return `La mortalidad se concentra en los mayores de 80; en la pirámide de «Sexo y edad» puedes desagregar por enfermedad y sexo.`;
  if(has('departamento','region','lima','provincia','mapa')){ const dt=D.por_departamento[y]||{}; const topd=Object.entries(dt).filter(([d])=>!d.includes('EXTRAN')&&!d.includes('DETERMIN')).sort((a,b)=>b[1]-a[1])[0]; return `Lima concentra la mayor cantidad de defunciones registradas. ${topd?topd[0]+': '+fmt(topd[1])+' en '+y+'.':''} En el mapa puedes hacer clic en un departamento para ver sus principales causas.`; }
  if(has('de que','principal','causa','mas comun','mata')||t==='')
    return `En ${y}, las principales causas registradas fueron: ${F.top.map(c=>`${c.etiqueta} (${fmt(c.n)})`).join(' · ')}. Pregúntame por cáncer, diabetes, homicidios, tránsito, sexo, edad o un departamento.`;
  if(has('hola','buenas','ayuda','que puedes','que haces'))
    return `Hola 👋 Soy el asistente del observatorio. Pregúntame «¿de qué morimos?», «¿cuántos homicidios?», «cáncer más común», «muertes por diabetes», «por sexo» o «en Lima».`;
  return `Puedo responder con los datos del observatorio (2017–${YEARS().at(-1)}): prueba «¿de qué morimos en el Perú?», «homicidios», «cáncer más común», «diabetes», «por sexo» o «en Lima».`;
}
async function gateway(history){
  const res=await fetch(TUNKY_URL,{method:'POST',
    headers:{'Content-Type':'application/json','X-Client-Token':TUNKY_TOKEN},
    body:JSON.stringify({messages:[{role:'system',content:CHAT_SYS}].concat(history.slice(-12))})});
  if(!res.ok) throw new Error('gateway '+res.status);
  const d=await res.json();
  return d.reply||d.message||d.answer||d.response||d.text||d.content||localAnswer(history.at(-1)?.content||'');
}
function wireChat(){
  const panel=$('#chatPanel'), body=$('#chatBody'), input=$('#chatInput');
  const history=[]; let greeted=false;
  function add(txt,who){const d=document.createElement('div');d.className='msg '+who;d.textContent=txt;body.appendChild(d);body.scrollTop=body.scrollHeight;return d;}
  function chips(){
    const wrap=document.createElement('div'); wrap.className='chips';
    ['¿De qué morimos?','¿Cuántos homicidios?','Cáncer más común','Muertes por diabetes'].forEach(q=>{
      const b=document.createElement('button'); b.textContent=q; b.onclick=()=>{wrap.remove(); handle(q);}; wrap.appendChild(b);
    });
    body.appendChild(wrap);
  }
  function greet(){ if(greeted)return; greeted=true; add('Hola 👋 Soy el asistente del observatorio. Puedo responder con datos reales de mortalidad del Perú.','bot'); chips(); }
  async function handle(q){
    add(q,'me'); history.push({role:'user',content:q});
    const t=add('…','bot');
    let reply;
    try{ reply = TUNKY_TOKEN ? await gateway(history) : localAnswer(q); }
    catch(e){ reply = localAnswer(q); }
    t.textContent=reply; history.push({role:'assistant',content:reply}); body.scrollTop=body.scrollHeight;
  }
  $('#chatBtn').onclick=()=>{panel.classList.toggle('open'); if(panel.classList.contains('open')) greet();};
  $('#chatClose').onclick=()=>panel.classList.remove('open');
  function send(){const q=input.value.trim(); if(!q)return; input.value=''; handle(q);}
  $('#chatSend').onclick=send; input.onkeydown=e=>{if(e.key==='Enter')send();};
}

// ================= navegación móvil =================
function wireNav(){
  const d=$('#drawer'), sc=$('#scrim'), btn=$('#menuBtn');
  if(!d||!btn) return;
  const setOpen=v=>{ d.classList.toggle('open',v); if(sc) sc.classList.toggle('open',v); btn.setAttribute('aria-expanded',v?'true':'false'); };
  btn.onclick=()=>setOpen(!d.classList.contains('open'));
  if(sc) sc.onclick=()=>setOpen(false);
  $$('#drawer a').forEach(a=>a.addEventListener('click',()=>setOpen(false)));
  addEventListener('keydown',e=>{ if(e.key==='Escape') setOpen(false); });
}
})();
