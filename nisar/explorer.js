/* Individual acquisition footprints; static metadata only. */
(() => {
  'use strict';
  const DAY=86400000, fmt=d3.utcFormat('%Y-%m-%d'), labelDate=d3.utcFormat('%b %d, %Y');
  const startInput=document.getElementById('date-start'), endInput=document.getElementById('date-end');
  const status=document.getElementById('range-status'), timeline=d3.select('#timeline'), map=document.getElementById('map');
  const picker=document.getElementById('shot-picker'), details=document.getElementById('shot-details');
  const bands={L:document.getElementById('band-l'),S:document.getElementById('band-s')};
  const colors={L:'#2f68c5',S:'#d4691d'};
  let shots=[], active=[], world, grid=new Map(), daily=[], minDay,maxDay,start,end;
  let projection, transform=d3.zoomIdentity, width,height,brush,xScale,syncing=false,selected=null,selectedPoint=null,page=0,raf=0;
  const canvases=[document.getElementById('basemap'),document.getElementById('shots-map')];
  const zoom=d3.zoom().scaleExtent([1,40]).clickDistance(5).on('zoom',event=>{transform=event.transform; scheduleMap();});
  function enabled(shot) { return bands[shot.band].checked && shot.t>=start && shot.t<end; }
  function parseTime(id) {
    const t=id.split('_')[11];
    return Date.UTC(+t.slice(0,4),+t.slice(4,6)-1,+t.slice(6,8),+t.slice(9,11),+t.slice(11,13),+t.slice(13,15));
  }
  function cellKey(lon,lat) { return `${Math.floor((lon+180)/2)},${Math.floor((lat+90)/2)}`; }
  function ingest(rows,band) {
    for(const row of rows) {
      const geo={type:row[1]?'MultiPolygon':'Polygon',coordinates:row[2]};
      const shot={id:row[0],geo,band,t:parseTime(row[0])};
      shot.day=Math.floor(shot.t/DAY)*DAY;
      const index=shots.length; shots.push(shot);
      const polys=row[1]?row[2]:[row[2]];
      for(const poly of polys) {
        const ring=poly[0], xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]);
        for(let i=Math.floor((Math.min(...xs)+180)/2);i<=Math.floor((Math.max(...xs)+180)/2);i++) {
          for(let j=Math.floor((Math.min(...ys)+90)/2);j<=Math.floor((Math.max(...ys)+90)/2);j++) {
            const key=`${i},${j}`; if(!grid.has(key)) grid.set(key,[]); grid.get(key).push(index);
          }
        }
      }
    }
  }
  async function loadJSON(url,gzip=false) {
    const response=await fetch(url); if(!response.ok) throw new Error(`Metadata request failed (${response.status})`);
    if(!gzip) return response.json();
    if(!('DecompressionStream' in window)) throw new Error('This explorer needs a browser with gzip DecompressionStream support. Please use a current Chrome, Edge, Firefox or Safari.');
    return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
  }
  function buildDaily() {
    const counts=new Map();
    for(const shot of shots) { if(!counts.has(shot.day)) counts.set(shot.day,{L:0,S:0}); counts.get(shot.day)[shot.band]++; }
    daily=d3.utcDay.range(new Date(minDay),new Date(maxDay+DAY)).map(date=>({date:+date,...(counts.get(+date)||{L:0,S:0})}));
  }
  function updateRange(from,to,moveBrush=true) {
    start=Math.max(minDay,Math.min(maxDay,from));
    end=Math.max(start+DAY,Math.min(maxDay+DAY,to));
    startInput.value=fmt(new Date(start)); endInput.value=fmt(new Date(end-DAY));
    if(moveBrush&&brush) { syncing=true; timeline.select('.brush').call(brush.move,[xScale(start),xScale(end)]); syncing=false; }
    active=shots.filter(enabled); page=0;
    const counts={L:0,S:0}; for(const shot of active) counts[shot.band]++;
    status.textContent=`${labelDate(new Date(start))}–${labelDate(new Date(end-DAY))} UTC · ${active.length.toLocaleString()} acquisition groups (${counts.L.toLocaleString()} L · ${counts.S.toLocaleString()} S)`;
    if(selected&&!enabled(selected)) { selected=null; details.textContent='The selected shot is outside the current filters.'; }
    if(selectedPoint) updateLocation(selectedPoint,false);
    if(document.getElementById('all-shots').open) renderList();
    scheduleMap();
  }
  function drawTimeline() {
    const w=timeline.node().getBoundingClientRect().width,h=146,left=42,right=12,top=18,bottom=108;
    timeline.attr('viewBox',`0 0 ${w} ${h}`).selectAll('*').remove();
    timeline.append('title').text('Daily NISAR acquisition groups, with date-range selection');
    xScale=d3.scaleUtc().domain([minDay,maxDay+DAY]).range([left,w-right]);
    const total=d=> (bands.L.checked?d.L:0)+(bands.S.checked?d.S:0);
    const y=d3.scaleLinear().domain([0,d3.max(daily,total)||1]).nice().range([bottom,top]);
    const barWidth=Math.max(.4,(w-left-right)/daily.length);
    for(const band of ['L','S']) {
      timeline.append('g').selectAll('rect').data(daily).join('rect')
        .attr('x',d=>xScale(d.date)).attr('width',barWidth)
        .attr('y',d=>y((band==='S'&&bands.L.checked?d.L:0)+(bands[band].checked?d[band]:0)))
        .attr('height',d=>bands[band].checked?y(band==='S'&&bands.L.checked?d.L:0)-y((band==='S'&&bands.L.checked?d.L:0)+d[band]):0)
        .attr('fill',colors[band]).attr('opacity',.75);
    }
    timeline.append('g').attr('class','axis').attr('transform',`translate(0,${bottom})`).call(d3.axisBottom(xScale).ticks(w<500?4:8).tickFormat(d3.utcFormat('%b %Y')));
    timeline.append('g').attr('class','axis').attr('transform',`translate(${left},0)`).call(d3.axisLeft(y).ticks(3).tickFormat(d3.format('~s')));
    timeline.append('text').attr('x',left).attr('y',11).text('Groups / day');
    brush=d3.brushX().extent([[left,top],[w-right,bottom]]).handleSize(12).on('brush end',event=>{
      if(syncing) return;
      if(!event.selection) { if(event.type==='end') updateRange(minDay,maxDay+DAY); return; }
      const [a,b]=event.selection.map(xScale.invert);
      let from=+d3.utcDay.round(a), to=+d3.utcDay.round(b);
      if(to<=from) to=from+DAY;
      updateRange(from,to,event.type==='end');
    });
    timeline.append('g').attr('class','brush').call(brush);
    syncing=true; timeline.select('.brush').call(brush.move,[xScale(start),xScale(end)]); syncing=false;
  }
  function scheduleMap() { if(!raf) raf=requestAnimationFrame(()=>{raf=0; drawMap();}); }
  function canvasContext(canvas) {
    const dpr=Math.min(window.devicePixelRatio||1,2);
    const ctx=canvas.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,width,height);
    ctx.translate(transform.x,transform.y); ctx.scale(transform.k,transform.k); return ctx;
  }
  function drawMap() {
    if(!world||!projection) return;
    const base=canvasContext(canvases[0]), path=d3.geoPath(projection,base);
    base.beginPath(); path({type:'Sphere'}); base.fillStyle='#eef4f8'; base.fill(); base.strokeStyle='#dce4ee'; base.lineWidth=1/transform.k; base.stroke();
    base.beginPath(); path(world); base.fillStyle='#e0e7ed'; base.fill(); base.strokeStyle='#bccad6'; base.lineWidth=.5/transform.k; base.stroke();
    const ctx=canvasContext(canvases[1]), shotPath=d3.geoPath(projection,ctx);
    for(const band of ['L','S']) {
      if(!bands[band].checked) continue;
      ctx.strokeStyle=colors[band]; ctx.globalAlpha=.30; ctx.lineWidth=.65/transform.k;
      let batch=0; ctx.beginPath();
      for(const shot of active) if(shot.band===band) {
        shotPath(shot.geo);
        if(++batch===250) {ctx.stroke(); ctx.beginPath(); batch=0;}
      }
      if(batch) ctx.stroke();
    }
    if(selected&&enabled(selected)) {
      ctx.globalAlpha=1; ctx.beginPath(); shotPath(selected.geo); ctx.fillStyle=colors[selected.band]; ctx.globalAlpha=.25; ctx.fill();
      ctx.globalAlpha=1; ctx.strokeStyle='#111827'; ctx.lineWidth=2/transform.k; ctx.stroke();
    }
    ctx.globalAlpha=1;
  }
  function resize() {
    width=map.clientWidth; height=map.clientHeight;
    const dpr=Math.min(window.devicePixelRatio||1,2);
    for(const canvas of canvases) {canvas.width=Math.round(width*dpr); canvas.height=Math.round(height*dpr);}
    projection=d3.geoEqualEarth().fitExtent([[8,8],[width-8,height-8]],{type:'Sphere'});
    transform=d3.zoomIdentity; d3.select(map).call(zoom.transform,transform);
    drawTimeline(); scheduleMap();
  }
  function describe(shot) {
    const t=shot.id.split('_');
    return `${shot.band}-band · ${new Date(shot.t).toISOString().replace('.000Z',' UTC')} · track ${t[5]} / frame ${t[7]} · ${t[9].slice(0,2)}`;
  }
  function selectShot(shot,focus=false) {
    selected=shot;
    details.replaceChildren();
    const text=document.createElement('span'); text.textContent=describe(shot); details.append(text,document.createElement('br'));
    const code=document.createElement('code'); code.textContent=shot.id; details.append(code,document.createElement('br'));
    const tokens=shot.id.split('_');
    const note=document.createElement('span'); note.textContent=`Processing: ${tokens[2]} · baseline ${tokens[13]} · bandwidth mode ${tokens[8]}. Footprint extent; valid pixels must be checked in the product.`; details.append(note);
    if(focus) {
      const bounds=d3.geoPath(projection).bounds(shot.geo), dx=bounds[1][0]-bounds[0][0],dy=bounds[1][1]-bounds[0][1];
      const k=Math.min(30,Math.max(1,.65/Math.max(dx/width,dy/height)));
      const center=[(bounds[0][0]+bounds[1][0])/2,(bounds[0][1]+bounds[1][1])/2];
      d3.select(map).call(zoom.transform,d3.zoomIdentity.translate(width/2-k*center[0],height/2-k*center[1]).scale(k));
    }
    scheduleMap();
  }
  function updateLocation(point,choose=true) {
    const indices=[...new Set(grid.get(cellKey(...point))||[])];
    const hits=indices.map(i=>shots[i]).filter(shot=>enabled(shot)&&d3.geoContains(shot.geo,point)).sort((a,b)=>b.t-a.t||a.band.localeCompare(b.band));
    picker.replaceChildren(); picker.disabled=!hits.length;
    if(!hits.length) {
      const option=document.createElement('option'); option.textContent='No shots here in the current date range'; picker.append(option);
      selected=null; details.textContent='No footprint covers this location with the selected dates and bands.'; scheduleMap(); return;
    }
    for(const shot of hits) { const option=document.createElement('option'); option.value=shot.id; option.textContent=describe(shot); picker.append(option); }
    picker.setAttribute('aria-label',`${hits.length.toLocaleString()} shots at selected location`);
    if(!choose&&selected&&hits.includes(selected)) picker.value=selected.id;
    else selectShot(hits[0]);
  }
  function renderList() {
    const list=document.getElementById('shot-list'),size=12;
    list.replaceChildren(); page=Math.max(0,Math.min(page,Math.max(0,Math.ceil(active.length/size)-1)));
    for(const shot of active.slice(page*size,(page+1)*size)) {
      const button=document.createElement('button'); button.type='button'; button.textContent=describe(shot); button.addEventListener('click',()=>selectShot(shot,true)); list.append(button);
    }
    document.getElementById('page-status').textContent=active.length?`${page*size+1}–${Math.min((page+1)*size,active.length)} of ${active.length.toLocaleString()}`:'No shots in this range';
    document.getElementById('previous-shots').disabled=page===0;
    document.getElementById('next-shots').disabled=(page+1)*size>=active.length;
  }
  async function initialize() {
    try {
      const [land,l,s]=await Promise.all([loadJSON('data/world.json'),loadJSON('data/l-shots.json.gz',true),loadJSON('data/s-shots.json.gz',true)]);
      world=land; ingest(l,'L'); ingest(s,'S');
      minDay=d3.min(shots,d=>d.day); maxDay=d3.max(shots,d=>d.day); start=minDay; end=maxDay+DAY;
      for(const input of [startInput,endInput]) {input.min=fmt(new Date(minDay)); input.max=fmt(new Date(maxDay));}
      buildDaily();
      d3.select(map).call(zoom);
      canvases[1].addEventListener('click',event=>{
        if(event.defaultPrevented) return;
        const rect=map.getBoundingClientRect(),xy=transform.invert([event.clientX-rect.left,event.clientY-rect.top]);
        const point=projection.invert(xy); if(!point||!point.every(Number.isFinite)) return;
        selectedPoint=point; updateLocation(point); scheduleMap();
      });
      picker.addEventListener('change',()=>{const shot=shots.find(s=>s.id===picker.value); if(shot) selectShot(shot);});
      for(const band of ['L','S']) bands[band].addEventListener('change',()=>{drawTimeline(); updateRange(start,end);});
      startInput.addEventListener('change',()=>{const value=+new Date(startInput.value); if(Number.isFinite(value)) updateRange(value,Math.max(value+DAY,end));});
      endInput.addEventListener('change',()=>{const value=+new Date(endInput.value)+DAY; if(Number.isFinite(value)) updateRange(Math.min(start,value-DAY),value);});
      document.getElementById('full-range').addEventListener('click',()=>updateRange(minDay,maxDay+DAY));
      document.getElementById('reset-map').addEventListener('click',()=>d3.select(map).call(zoom.transform,d3.zoomIdentity));
      document.getElementById('all-shots').addEventListener('toggle',()=>{if(document.getElementById('all-shots').open) renderList();});
      document.getElementById('previous-shots').addEventListener('click',()=>{page--; renderList();});
      document.getElementById('next-shots').addEventListener('click',()=>{page++; renderList();});
      new ResizeObserver(resize).observe(map);
      updateRange(start,end,false); resize();
    } catch(error) {status.textContent=`Unable to load explorer: ${error.message}`;status.setAttribute('role','alert');}
  }
  initialize();
})();
