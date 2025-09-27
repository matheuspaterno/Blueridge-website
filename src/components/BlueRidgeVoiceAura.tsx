"use client";
import React, { useEffect, useRef, useState } from "react";

/**
 * BlueRidgeVoiceAura
 * A GPU-accelerated, audio‑reactive "consciousness" orb inspired by GPT‑5 Talk.
 *
 * Features
 * - WebGL2 fragment shader with flowing noise and color blending
 * - Reacts to microphone input (listen) and/or TTS audio element (speak)
 * - Graceful fallback to Canvas2D if WebGL is unavailable
 * - Minimal API you can drop into any app
 *
 * Props
 * state: "idle" | "listen" | "speak"
 * micStream: optional MediaStream (microphone)
 * ttsAudioEl: optional HTMLAudioElement that plays assistant speech
 * size: pixel square size (default 320)
 */

function avg(arr: Uint8Array) { let s = 0; for (let i=0;i<arr.length;i++) s += arr[i]; return s / Math.max(1, arr.length); }

function useAnalyser({ micStream, ttsAudioEl }: { micStream?: MediaStream | null, ttsAudioEl?: HTMLAudioElement | null }) {
  const [ctx] = useState(() => (typeof window !== 'undefined' ? new (window.AudioContext || (window as any).webkitAudioContext)() : null));
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataRef = useRef<any>(null); // lax typing to avoid TS ArrayBuffer constraint differences

  useEffect(() => {
    if (!ctx) return;
    analyserRef.current?.disconnect();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.85;
    analyserRef.current = analyser;

    const inputs: AudioNode[] = [];
    if (micStream) {
      try { const micSrc = ctx.createMediaStreamSource(micStream); micSrc.connect(analyser); inputs.push(micSrc); } catch (e) { console.warn('Mic source error', e); }
    }
    if (ttsAudioEl) {
      try {
        const ttsSrc = (ttsAudioEl as any)._br_media_source || ctx.createMediaElementSource(ttsAudioEl);
        (ttsAudioEl as any)._br_media_source = ttsSrc;
        ttsSrc.connect(analyser); ttsSrc.connect(ctx.destination); inputs.push(ttsSrc);
      } catch (e) { console.warn('TTS source error', e); }
    }
  // Allocate a fresh ArrayBuffer-backed Uint8Array (avoid any SAB inference issues)
  dataRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    return () => { try { inputs.forEach(n => n.disconnect()); analyser.disconnect(); } catch {} };
  }, [ctx, micStream, ttsAudioEl]);

  return {
    getLevels: () => {
      const analyser = analyserRef.current; const data = dataRef.current;
      if (!analyser || !data) return { level: 0, low:0, mid:0, high:0 };
  // TS quirk: getByteFrequencyData expects Uint8Array but union disturbs inference in some TS versions
  analyser.getByteFrequencyData(data);
      const len = data.length; const third = Math.floor(len/3);
      const low = avg(data.subarray(0, third));
      const mid = avg(data.subarray(third, 2*third));
      const high = avg(data.subarray(2*third));
      const level = (low + mid + high) / 3 / 255;
      return { level, low: low/255, mid: mid/255, high: high/255 };
    }
  };
}

const fragShader = `#version 300 es
precision highp float;
out vec4 outColor;
uniform vec2 u_res;uniform float u_time;uniform float u_level;uniform vec3 u_bands;uniform int u_state;
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float noise(vec2 p){vec2 i=floor(p);vec2 f=fract(p);float a=hash(i);float b=hash(i+vec2(1.,0.));float c=hash(i+vec2(0.,1.));float d=hash(i+vec2(1.,1.));vec2 u=f*f*(3.-2.*f);return mix(a,b,u.x)+(c-a)*u.y*(1.-u.x)+(d-b)*u.x*u.y;}
float fbm(vec2 p){float s=0.;float a=0.5;for(int i=0;i<5;i++){s+=a*noise(p);p*=2.;a*=0.5;}return s;}
void main(){vec2 uv=(gl_FragCoord.xy-0.5*u_res)/u_res.y;float t=u_time*0.22;float amp=0.2+0.8*u_level;vec3 bands=u_bands;float stateBoost=float(u_state==1)*0.05+float(u_state==2)*0.1;float r=length(uv);
// Faster rotation & drift for clouds
vec2 p=uv*rot(t*0.42+bands.x*0.6);p+=vec2(t*0.14, -t*0.095);
// Add subtle turbulent variation for extra motion in highlights
float baseLayer = fbm(p*2.7 + t*0.15);
float midLayer  = fbm(p*5.4 + 10. + t*0.25);
float hiLayer   = fbm(p*11. + 30. - t*0.35);
float n = baseLayer * 0.55 + midLayer * 0.28 + hiLayer * 0.17;
float cloud = smoothstep(0.33, 0.92, n + amp*0.27 + bands.y*0.18);
float edge = smoothstep(0.62+stateBoost,0.18,r);
vec3 night = vec3(0.025,0.07,0.18); // richer deep blue
vec3 cloudTint = mix(vec3(0.88,0.9,0.94), vec3(1.0), bands.z*0.55 + float(u_state==2)*0.35);
// Slight sparkle effect from hiLayer modulation
float sparkle = smoothstep(0.75,0.95,hiLayer) * 0.15 * (0.4 + bands.z*0.6);
vec3 col = mix(night, cloudTint, cloud*(0.58+0.42*amp)) + sparkle;
col *= edge;
float outline = smoothstep(0.60+stateBoost,0.585+stateBoost,r)*(0.18+0.55*bands.x);
col += vec3(outline);
col = pow(col, vec3(1./1.55));
outColor = vec4(col, edge);
}
`;
const vertShader = `#version 300 es
in vec2 a_pos;void main(){gl_Position=vec4(a_pos,0.,1.);} `;

function createGL(canvas: HTMLCanvasElement){
  const gl = canvas.getContext('webgl2',{premultipliedAlpha:false,antialias:true}); if(!gl) return null;
  const compile = (src:string,type:number)=>{ const sh=gl.createShader(type)!; gl.shaderSource(sh,src); gl.compileShader(sh); if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS)){ throw new Error(gl.getShaderInfoLog(sh)||'shader'); } return sh; };
  const vs=compile(vertShader, gl.VERTEX_SHADER); const fs=compile(fragShader, gl.FRAGMENT_SHADER);
  const prog=gl.createProgram()!; gl.attachShader(prog,vs); gl.attachShader(prog,fs); gl.linkProgram(prog); if(!gl.getProgramParameter(prog,gl.LINK_STATUS)){ throw new Error(gl.getProgramInfoLog(prog)||'link'); }
  const vao=gl.createVertexArray(); gl.bindVertexArray(vao); const buf=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
  return { gl, prog } as const;
}

function setUniforms(gl: WebGL2RenderingContext, prog: WebGLProgram, u: any){
  gl.useProgram(prog);
  const loc=(n:string)=>gl.getUniformLocation(prog,n);
  const L=(n:string)=>{ const l=loc(n); return l; };
  const lr=L('u_res'); if(lr) gl.uniform2f(lr,u.u_res[0],u.u_res[1]);
  const lt=L('u_time'); if(lt) gl.uniform1f(lt,u.u_time);
  const ll=L('u_level'); if(ll) gl.uniform1f(ll,u.u_level);
  const lb=L('u_bands'); if(lb) gl.uniform3f(lb,u.u_bands[0],u.u_bands[1],u.u_bands[2]);
  const ls=L('u_state'); if(ls) gl.uniform1i(ls,u.u_state);
}

function canvas2dFallback(ctx: CanvasRenderingContext2D, w:number, h:number, t:number, bands:{level:number,low:number,mid:number,high:number}, state:string){
  ctx.clearRect(0,0,w,h); const cx=w/2, cy=h/2; const baseR=Math.min(w,h)*0.35; const r = baseR*(1+0.11*bands.level + (state==='speak'?0.07: state==='listen'?0.035:0));
  const g=ctx.createRadialGradient(cx,cy,r*0.25,cx,cy,r);
  g.addColorStop(0,'#041226');
  g.addColorStop(1,'#02101F');
  ctx.fillStyle=g; ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
  // Faster moving layered cloud highlights
  const layers=6; ctx.save(); ctx.globalCompositeOperation='lighter';
  for(let i=0;i<layers;i++){
    const phase = t*0.25 + i*1.55;
    const alpha = (0.045 + 0.11*bands.level) * (1 - i/layers) + (state==='speak'?0.01:0);
    ctx.beginPath();
    const rr = r * (0.38 + 0.52*i/layers);
    const wobble = Math.sin(phase*1.2 + i*0.7)*0.18*r;
    const wobbleY = Math.cos(phase*0.9 + i)*0.09*r;
    ctx.ellipse(cx + wobble*0.2, cy + wobbleY*0.3, rr*1.25, rr*0.6, Math.sin(phase)*0.5, 0, Math.PI*2);
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fill();
  }
  ctx.restore();
  ctx.lineWidth=3; ctx.strokeStyle='rgba(255,255,255,0.22)'; ctx.stroke();
}

export function BlueRidgeVoiceAura({ state='idle', micStream=null, ttsAudioEl=null, size=320, className='', backgroundColor='#061224' }: { state?:'idle'|'listen'|'speak', micStream?:MediaStream|null, ttsAudioEl?:HTMLAudioElement|null, size?:number, className?:string, backgroundColor?:string }){
  const canvasRef=useRef<HTMLCanvasElement|null>(null); const glRef=useRef<WebGL2RenderingContext|null>(null); const progRef=useRef<WebGLProgram|null>(null); const startRef=useRef<number>(performance.now());
  const { getLevels } = useAnalyser({ micStream, ttsAudioEl });

  useEffect(()=>{ const canvas=canvasRef.current; if(!canvas) return; const dpr=Math.min(2, window.devicePixelRatio||1); canvas.style.width=size+'px'; canvas.style.height=size+'px'; canvas.width=Math.floor(size*dpr); canvas.height=Math.floor(size*dpr); },[size]);
  useEffect(()=>{ const canvas=canvasRef.current; if(!canvas) return; try{ const created=createGL(canvas); if(!created) throw new Error('no webgl2'); glRef.current=created.gl; progRef.current=created.prog; }catch(e){ console.warn('[Aura] WebGL fallback', e); glRef.current=null; progRef.current=null; } },[]);
  useEffect(()=>{ let raf=0; const loop=()=>{ const canvas=canvasRef.current; if(!canvas) return; const t=(performance.now()-startRef.current)/1000; const bands=getLevels(); if(glRef.current && progRef.current){ const gl=glRef.current; gl.viewport(0,0,canvas.width,canvas.height); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); setUniforms(gl,progRef.current,{ u_res:[canvas.width, canvas.height], u_time:t, u_level:bands.level, u_bands:[bands.low,bands.mid,bands.high], u_state: state==='speak'?2: state==='listen'?1:0 }); gl.drawArrays(gl.TRIANGLES,0,6);} else { const ctx2d=canvas.getContext('2d'); if(ctx2d) canvas2dFallback(ctx2d, canvas.width, canvas.height, t, bands, state); } raf=requestAnimationFrame(loop); }; raf=requestAnimationFrame(loop); return ()=>cancelAnimationFrame(raf); },[getLevels,state]);

  const ringColor = state==='speak'? 'shadow-green-500/60' : state==='listen' ? 'shadow-cyan-500/60' : 'shadow-slate-500/30';
  return (
    <div className={`relative inline-flex items-center justify-center ${className}`} style={{ width:size, height:size }}>
      <div className="absolute inset-0 rounded-full" style={{ background: backgroundColor }} />
      <div className="absolute inset-0 rounded-full blur-2xl opacity-60" style={{ background: 'radial-gradient(circle at 60% 40%, rgba(255,255,255,0.08), rgba(0,0,20,0))' }} />
      <canvas ref={canvasRef} className="rounded-full relative" />
      <div className={`pointer-events-none absolute inset-0 rounded-full ring-1 ring-white/10 shadow-2xl ${ringColor}`} />
    </div>
  );
}

export default BlueRidgeVoiceAura;
