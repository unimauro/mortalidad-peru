/* ===== Observatorio de Mortalidad del Perú ===== */
(() => {
'use strict';
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const fmt = n => (n==null ? '—' : n.toLocaleString('es-PE'));
const fmt1 = n => (n==null ? '—' : Number(n).toLocaleString('es-PE',{maximumFractionDigits:1}));

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
function baseGrid(){ const p=palette(); return {left:8,right:14,top:26,bottom:8,containLabel:true}; }
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

function init(){
  // fecha
  const dt = new Date(D.meta.fecha_proceso);
  $('#lastUpdate').textContent = dt.toLocaleDateString('es-PE',{day:'numeric',month:'long',year:'numeric'});
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
  reg('ch_vih', chVih);
  rerenderAll();
  wireControls();
  buildSemaforo();
  wireCSV();
  wireChat();
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
        data:[[{xAxis:'2020',name:'COVID-19'},{xAxis:'2021'}]],
        label:{show:true,color:p.soft,fontSize:10,position:'insideTop'}},
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
  const rows=(D.causas_por_anio[y]||[]).filter(r=>r.grupo!=='otras').slice(0,12).reverse();
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
    data:ys.map(y=>{ if(y===PARTIAL())return null; return D.series[g][metaMetric][y]; })
  }));
  c.setOption({
    grid:baseGrid(), legend:{bottom:0,textStyle:{color:p.soft,fontSize:11},icon:'roundRect'},
    tooltip:tt({trigger:'axis',valueFormatter:v=>v==null?'—':fmt1(v)}),
    xAxis:Object.assign({type:'category',data:ys,boundaryGap:false},axisStyle()),
    yAxis:Object.assign({type:'value',name:unidad,nameTextStyle:{color:p.soft,fontSize:10}},axisStyle()),
    series
  }, true);
}

function chCrim(){
  const p=palette(), c=ec('ch_crim'), ys=YEARS();
  const mk=(g,i)=>({name:D.etiquetas[g].etiqueta,type:'line',smooth:true,symbol:'circle',symbolSize:6,
    lineStyle:{width:2.5,color:i===0?p.cat[3]:p.cat[4]},itemStyle:{color:i===0?p.cat[3]:p.cat[4]},
    data:ys.map(y=>y===PARTIAL()?null:D.series[g]?.conteo?.[y]),connectNulls:true});
  c.setOption({
    grid:baseGrid(), legend:{bottom:0,textStyle:{color:p.soft,fontSize:11}},
    tooltip:tt({trigger:'axis'}),
    xAxis:Object.assign({type:'category',data:ys,boundaryGap:false},axisStyle()),
    yAxis:Object.assign({type:'value',name:'defunciones registradas',nameTextStyle:{color:p.soft,fontSize:10}},axisStyle()),
    series:[mk('homicidio',0),mk('suicidio',1)]
  }, true);
}
function chCrimSexo(){
  const p=palette(), c=ec('ch_crimSexo'), y=lastFull();
  const g=['homicidio','suicidio'];
  const val=(gr,s)=>D.por_sexo[gr]?.[y]?.[s]||0;
  c.setOption({
    grid:baseGrid(), legend:{bottom:0,textStyle:{color:p.soft,fontSize:11}},
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
  c.setOption({
    grid:baseGrid(), legend:{bottom:0,textStyle:{color:p.soft,fontSize:11},type:'scroll'},
    tooltip:tt({trigger:'axis',axisPointer:{type:'shadow'}}),
    xAxis:Object.assign({type:'category',data:ys},axisStyle()),
    yAxis:Object.assign({type:'value',name:'defunciones registradas',nameTextStyle:{color:p.soft,fontSize:10}},axisStyle()),
    series
  }, true);
}

function chPyr(){
  const p=palette(), c=ec('ch_pyr'), y=$('#yearPyr').value;
  const ages=D.grupos_edad;
  const M=ages.map(a=>-(D.piramide[y]?.M?.[a]||0));
  const F=ages.map(a=>(D.piramide[y]?.F?.[a]||0));
  const maxv=Math.max(1,...M.map(v=>-v),...F);
  c.setOption({
    grid:{left:8,right:20,top:10,bottom:30,containLabel:true},
    legend:{bottom:0,textStyle:{color:p.soft,fontSize:11}},
    tooltip:tt({trigger:'axis',axisPointer:{type:'shadow'},
      formatter:a=>{const i=a[0].dataIndex; return `Edad ${ages[i]}<br>Hombres: ${fmt(Math.abs(M[i]))}<br>Mujeres: ${fmt(F[i])}`;}}),
    xAxis:Object.assign({type:'value',max:maxv,min:-maxv,axisLabel:{formatter:v=>fmt(Math.abs(v)),color:p.soft,fontSize:10}},axisStyle()),
    yAxis:Object.assign({type:'category',data:ages,axisLabel:{color:p.soft,fontSize:10}},axisStyle()),
    series:[
      {name:'Hombres',type:'bar',stack:'p',data:M,itemStyle:{color:p.cat[0]}},
      {name:'Mujeres',type:'bar',stack:'p',data:F,itemStyle:{color:p.cat[4]}}
    ]
  }, true);
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
}

function chCancer(){
  const p=palette(), c=ec('ch_cancer'), y=lastFull();
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
    data:ys.map(y=>y===PARTIAL()?null:D.series[g]?.conteo?.[y]),connectNulls:true});
  c.setOption({
    grid:baseGrid(), legend:{bottom:0,textStyle:{color:p.soft,fontSize:11}},
    tooltip:tt({trigger:'axis'}),
    xAxis:Object.assign({type:'category',data:ys,boundaryGap:false},axisStyle()),
    yAxis:Object.assign({type:'value',name:'defunciones registradas',nameTextStyle:{color:p.soft,fontSize:10}},axisStyle()),
    series:[mk('vih_sida',0,p.cat[4]), mk('covid19',1,p.cat[3])]
  }, true);
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
  ];
  ul.innerHTML=items.map(t=>`<li>${t}</li>`).join('');
}

// ================= controles =================
function wireControls(){
  $('#yearCauses').onchange=chTop;
  $('#yearPyr').onchange=chPyr;
  $('#yearMap').onchange=chMap;
  $('#causeMap').onchange=chMap;
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
    pyr:()=>{const y=$('#yearPyr').value;const rows=[['anio','grupo_edad','sexo','defunciones']];D.grupos_edad.forEach(a=>['M','F'].forEach(s=>rows.push([y,a,s,D.piramide[y]?.[s]?.[a]||0])));return rows;},
    map:()=>{const y=$('#yearMap').value;const rows=[['anio','departamento','tasa_x100k','defunciones']];Object.keys(D.por_departamento[y]||{}).forEach(dep=>rows.push([y,dep,(D.tasa_departamento[y]||{})[dep]??'',D.por_departamento[y][dep]]));return rows;},
    cancer:()=>{const y=lastFull();return [['anio','tipo_cancer','defunciones'],...Object.entries(D.cancer_subtipos[y]||{}).map(([k,v])=>[y,k,v])];},
    vih:()=>{const rows=[['anio','causa','defunciones']];['vih_sida','covid19'].forEach(g=>ys.forEach(y=>rows.push([y,D.etiquetas[g].etiqueta,D.series[g]?.conteo?.[y]||0])));return rows;},
  };
  $$('[data-csv]').forEach(b=>b.onclick=()=>{const k=b.dataset.csv; if(gens[k]) download(`mortalidad-peru_${k}.csv`, gens[k]());});
}

// ================= chat (stub, gateway pendiente) =================
function wireChat(){
  const panel=$('#chatPanel'), body=$('#chatBody'), input=$('#chatInput');
  $('#chatBtn').onclick=()=>panel.classList.toggle('open');
  $('#chatClose').onclick=()=>panel.classList.remove('open');
  function add(txt,who){const d=document.createElement('div');d.className='msg '+who;d.textContent=txt;body.appendChild(d);body.scrollTop=body.scrollHeight;}
  function send(){const q=input.value.trim(); if(!q)return; add(q,'me'); input.value='';
    setTimeout(()=>add('El asistente con IA se activará pronto (falta el token del gateway ai.tunky.net). Mientras tanto, explora los gráficos y descarga los datos en CSV.','bot'),350);}
  $('#chatSend').onclick=send; input.onkeydown=e=>{if(e.key==='Enter')send();};
}
})();
